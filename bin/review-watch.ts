#!/usr/bin/env bun
import { $ } from "bun";
import { Command } from "commander";
import fs from "fs";
import path from "path";
import { consola } from "consola";
import chalk from "chalk";
import { iso_timestamp, ensureEditorPermissions } from "./common";
import { GitHubClient, readGithubToken, readRepoInfo } from "./github-client";
import { config } from "./config";
import { SessionManager } from "./session-manager";
import { SessionPathManager } from "./session-paths";

const logger = consola.withTag("review-watch");

/**
 * review-watch.ts - 审查监听器：检测 PR 新提交并触发 Reviewer Agent
 *
 * 流程：
 * 1. 读取 status.json → 获取 PR 编号、分支、worktree 路径
 * 2. 获取 PR 当前 head SHA 作为 baseline
 * 3. 轮询循环：
 *    - 检测 PR 合并/关闭 → 退出
 *    - 检测新提交（head SHA 变化）→ 获取 diff → 写入 review-diff.json → 启动 Reviewer Agent
 *    - 等待 Agent 完成 → 继续轮询
 * 4. Ctrl+C 优雅退出
 */

interface StatusData {
  issueNumber: number;
  status: string;
  branchName: string;
  worktreePath: string;
  title: string;
  repo: { owner: string; name: string };
  prUrl?: string;
  prNumber?: number;
  [key: string]: any;
}

async function resolvePrNumber(statusData: StatusData): Promise<number> {
  if (statusData.prNumber) return statusData.prNumber;

  if (statusData.prUrl) {
    const match = statusData.prUrl.match(/\/pull\/(\d+)/);
    if (match) return Number(match[1]);
  }

  const { owner, name } = statusData.repo;
  logger.info(`prUrl 不存在，通过分支 ${statusData.branchName} 查找 PR...`);

  const tokenRes = await readGithubToken();
  const ghEnv = tokenRes.success
    ? { ...process.env, GH_TOKEN: tokenRes.data }
    : { ...process.env };

  const result =
    await $`gh pr list --repo ${owner}/${name} --head ${statusData.branchName} --json number --jq '.[0].number'`.env(ghEnv).text();
  const prNumber = Number(result.trim());

  if (!prNumber || isNaN(prNumber)) {
    throw new Error(`无法找到分支 ${statusData.branchName} 对应的 PR`);
  }

  return prNumber;
}

function writeReviewDiffFile(
  paths: SessionPathManager,
  prNumber: number,
  headSha: string,
  files: any[],
  diff: string,
  repo: { owner: string; name: string },
  session: SessionManager,
): string {
  const filePath = paths.getReviewDiffFile();

  const data = {
    meta: {
      owner: repo.owner,
      repo: repo.name,
      pr_number: prNumber,
      head_sha: headSha,
      fetched_at: iso_timestamp(),
    },
    files: files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      patch: f.patch,
    })),
    diff,
  };

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  session.logEvent("review-diff-written", {
    prNumber,
    headSha,
    fileCount: files.length,
  });
  return filePath;
}

function syncPromptsToWorktree(worktreePath: string): void {
  const logTag = config.getLogTag();
  const editor =
    config.EDITORS.find((e) => e.id === logTag) || config.EDITORS[0];

  for (const mapping of editor.mappings) {
    const sourceDir = path.join(config.ROOT_DIR, mapping.from);
    const targetPath = path.join(worktreePath, mapping.to);

    if (!fs.existsSync(sourceDir)) continue;

    fs.mkdirSync(targetPath, { recursive: true });
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        fs.copyFileSync(
          path.join(sourceDir, entry.name),
          path.join(targetPath, entry.name),
        );
      }
    }
  }

  logger.info(`已同步 prompts/skills 到 worktree (${editor.name})`);
}

async function launchReviewerAgent(
  issueNumber: string,
  worktreePath: string,
  options: { ci: boolean; detach: boolean },
  paths: SessionPathManager,
): Promise<void> {
  syncPromptsToWorktree(worktreePath);
  ensureEditorPermissions(worktreePath);

  const logTag = config.getLogTag();
  const editor = config.EDITORS.find((e) => e.id === logTag);

  let cmd = editor?.runTemplate || "{tag} --prompt-template {workflow} {num}";
  cmd = cmd
    .replace("{tag}", logTag)
    .replace("{workflow}", "review-pr-diff")
    .replace("{num}", issueNumber);

  const fullCmd = `cd ${worktreePath} && ${cmd}`;

  logger.info(`启动 Reviewer Agent (${editor?.name || logTag})...`);
  logger.info(`执行命令: ${chalk.cyan(cmd)}`);

  if (options.ci) {
    await execAgentCi(fullCmd);
  } else {
    await execAgentTmux(fullCmd, issueNumber, paths);
  }
}

async function execAgentCi(cmd: string): Promise<void> {
  const proc = Bun.spawn(["bash", "-c", cmd], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (proc.stdout) {
    const reader = proc.stdout.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      process.stdout.write(new TextDecoder().decode(value));
    }
  }

  if (proc.stderr) {
    const reader = proc.stderr.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      process.stderr.write(new TextDecoder().decode(value));
    }
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    logger.warn(`Reviewer Agent 退出码: ${exitCode}`);
  }
}

async function execAgentTmux(
  cmd: string,
  issueNumber: string,
  paths: SessionPathManager,
): Promise<void> {
  const windowName = `review-watch-${issueNumber}`;
  const logFile = paths.getReviewWatchTmuxLogFile();

  // 注入 reviewer 角色环境变量，确保使用独立 GitHub 身份
  const envExports: string[] = [];
  envExports.push(`export ALONG_AGENT_ROLE='reviewer'`);
  const tokenRes = await readGithubToken();
  if (tokenRes.success) {
    envExports.push(`export GH_TOKEN='${tokenRes.data}'`);
  }
  const envSetup = envExports.join("; ") + "; ";

  const safeCmd = `bash -c '
    ${envSetup}echo "Starting review agent at $(date)" > ${logFile}
    ${cmd.replace(/'/g, "'\\''")} 2>&1 | tee -a ${logFile}
    EXIT_CODE=\${PIPESTATUS[0]}
    if [ \${EXIT_CODE} -ne 0 ]; then
      echo ""
      echo "Reviewer Agent 意外崩溃 (退出码: \${EXIT_CODE})"
      echo "日志已保存到: ${logFile}"
      echo "按 Enter 键关闭当前窗口..."
      read
      exit \${EXIT_CODE}
    fi
  '`;

  await $`tmux new-window -d -n ${windowName} ${safeCmd}`;
  logger.success(`Tmux 窗口已创建: ${windowName}`);
}

async function isTmuxWindowAlive(windowName: string): Promise<boolean> {
  try {
    const result = await $`tmux list-windows -F '#{window_name}'`.text();
    return result.split("\n").some((line) => line.trim() === windowName);
  } catch {
    return false;
  }
}

async function waitForReviewerCompletion(
  issueNumber: string,
  pollInterval: number,
  paths: SessionPathManager,
): Promise<void> {
  const tmuxWindow = `review-watch-${issueNumber}`;

  while (true) {
    await Bun.sleep(pollInterval * 1000);

    const alive = await isTmuxWindowAlive(tmuxWindow);
    if (!alive) {
      const logFile = paths.getReviewWatchTmuxLogFile();
      if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, "utf-8");
        const lines = content.split("\n");
        const tail = lines.slice(-5).join("\n");
        logger.info(`Reviewer Agent 已完成。最近日志:\n${tail}`);
      } else {
        logger.info("Reviewer Agent 已完成");
      }
      return;
    }
  }
}

async function pollLoop(
  issueNumber: string,
  prNumber: number,
  statusData: StatusData,
  options: { interval: number; ci: boolean; detach: boolean },
  paths: SessionPathManager,
) {
  const tokenRes = await readGithubToken();
  if (!tokenRes.success) {
    logger.error(`GitHub 认证失败: ${tokenRes.error}`);
    process.exit(1);
  }
  const client = new GitHubClient(
    tokenRes.data,
    statusData.repo.owner,
    statusData.repo.name,
  );

  const session = new SessionManager(
    paths.getOwner(),
    paths.getRepo(),
    Number(issueNumber),
  );

  // 获取当前 PR head SHA 作为 baseline
  logger.info("获取 PR 当前状态...");
  const pr = await client.getPullRequest(prNumber);
  let lastSeenSha = pr.head.sha;
  logger.info(`当前 head SHA: ${lastSeenSha.slice(0, 8)}`);

  // 首次启动时立即执行一次审查
  logger.info("首次启动，立即执行代码审查...");
  const files = await client.getPullRequestFiles(prNumber);
  const diff = await client.getPullRequestDiff(prNumber);

  if (files.length > 0) {
    const diffFile = writeReviewDiffFile(
      paths,
      prNumber,
      lastSeenSha,
      files,
      diff,
      statusData.repo,
      session,
    );
    logger.info(`Diff 数据已写入: ${diffFile} (${files.length} 个文件)`);

    session.logEvent("reviewer-agent-launched", {
      trigger: "initial",
      headSha: lastSeenSha,
      fileCount: files.length,
    });
    await launchReviewerAgent(issueNumber, statusData.worktreePath, options, paths);

    if (!options.ci) {
      logger.info("等待 Reviewer Agent 完成...");
      await waitForReviewerCompletion(issueNumber, 10, paths);
      session.logEvent("reviewer-agent-completed", { trigger: "initial" });
    }
  } else {
    logger.info("PR 无变更文件，跳过首次审查");
  }

  logger.log("");
  logger.info(chalk.bold(`轮询中 (每 ${options.interval}s)... 按 Ctrl+C 退出`));

  let pollCount = 0;
  const startTime = new Date();

  while (true) {
    await Bun.sleep(options.interval * 1000);
    pollCount++;

    try {
      const pr = await client.getPullRequest(prNumber);
      const now = new Date();
      const timeStr = now.toLocaleTimeString("zh-CN", { hour12: false });
      const elapsed = Math.floor((now.getTime() - startTime.getTime()) / 1000);
      const elapsedStr = `${Math.floor(elapsed / 60)}分${elapsed % 60}秒`;

      // 检查 PR 合并/关闭
      if (pr.state === "closed" || pr.merged) {
        logger.log("");
        if (pr.merged) {
          logger.success(chalk.green(`[${timeStr}] PR 已合并！审查监听结束`));
          session.logEvent("review-watch-pr-merged", { prNumber, elapsedStr });
        } else {
          logger.info(chalk.yellow(`[${timeStr}] PR 已关闭，审查监听结束`));
          session.logEvent("review-watch-pr-closed", { prNumber, elapsedStr });
        }
        logger.info("Bye!");
        process.exit(0);
      }

      // 检测新提交
      const headSha = pr.head.sha;
      if (headSha === lastSeenSha) {
        logger.info(
          `[${timeStr}] 轮询中 (第${pollCount}次, 已运行${elapsedStr})... 无新提交`,
        );
        continue;
      }

      logger.log("");
      logger.info(
        chalk.yellow(
          `[${timeStr}] 检测到新提交！${lastSeenSha.slice(0, 8)} → ${headSha.slice(0, 8)}`,
        ),
      );

      // 获取最新 diff
      const files = await client.getPullRequestFiles(prNumber);
      const diff = await client.getPullRequestDiff(prNumber);

      const diffFile = writeReviewDiffFile(
        paths,
        prNumber,
        headSha,
        files,
        diff,
        statusData.repo,
        session,
      );
      logger.info(`Diff 数据已写入: ${diffFile} (${files.length} 个文件)`);

      lastSeenSha = headSha;

      // 启动 Reviewer Agent
      session.logEvent("reviewer-agent-launched", {
        trigger: "new-commit",
        headSha,
        fileCount: files.length,
      });
      await launchReviewerAgent(issueNumber, statusData.worktreePath, options, paths);

      if (!options.ci) {
        logger.info("等待 Reviewer Agent 完成...");
        await waitForReviewerCompletion(issueNumber, 10, paths);
        session.logEvent("reviewer-agent-completed", { trigger: "new-commit" });
      }

      logger.log("");
      logger.info(
        chalk.bold(
          `Reviewer Agent 处理完毕，继续监听 (每 ${options.interval}s)... 按 Ctrl+C 退出`,
        ),
      );
    } catch (error: any) {
      const timeStr = new Date().toLocaleTimeString("zh-CN", { hour12: false });
      logger.error(`[${timeStr}] 轮询出错: ${error.message}`);
      session.log(`review-watch 轮询出错: ${error.message}\n${error.stack || ""}`, "error");
      logger.info("将在下一轮继续...");
    }
  }
}

async function main() {
  const program = new Command();
  program
    .name("review-watch")
    .description("监听 PR 新提交并自动触发 Reviewer Agent 进行代码审查")
    .argument("<issue-number>", "Issue 编号")
    .option("--interval <seconds>", "轮询间隔（秒）", "60")
    .option("--ci", "CI 模式：跳过 tmux，直接前台执行", false)
    .option("-d, --detach", "创建 tmux 窗口后不自动切换", false)
    .parse();

  const [issueNumber] = program.args;
  const opts = program.opts();
  const interval = Number(opts.interval);

  if (!issueNumber) {
    logger.error("缺少必要参数: issue-number");
    process.exit(1);
  }

  config.ensureDataDirs();

  // 获取 owner/repo
  const repoInfoRes = await readRepoInfo();
  if (!repoInfoRes.success) {
    logger.error(repoInfoRes.error);
    process.exit(1);
  }
  const { owner, repo } = repoInfoRes.data;
  const paths = new SessionPathManager(owner, repo, Number(issueNumber));

  // 读取 status.json
  const statusFile = paths.getStatusFile();
  if (!fs.existsSync(statusFile)) {
    logger.error(`状态文件不存在: ${statusFile}`);
    logger.error("请先通过 along run 创建任务");
    process.exit(1);
  }

  const statusData: StatusData = JSON.parse(
    fs.readFileSync(statusFile, "utf-8"),
  );

  // 解析 PR number
  let prNumber: number = 0;
  try {
    prNumber = await resolvePrNumber(statusData);
  } catch (error: any) {
    logger.error(error.message);
    process.exit(1);
  }

  // 启动前检查 PR 状态
  const tokenRes = await readGithubToken();
  if (!tokenRes.success) {
    logger.error(`GitHub 认证失败: ${tokenRes.error}`);
    process.exit(1);
  }
  const preCheckClient = new GitHubClient(tokenRes.data, owner, repo);
  const prInfo = await preCheckClient.getPullRequest(prNumber);

  if (prInfo.merged) {
    logger.success(`PR #${prNumber} 已合并，无需审查`);
    process.exit(0);
  }

  if (prInfo.state === "closed") {
    logger.info(`PR #${prNumber} 已关闭（未合并），无需审查`);
    process.exit(0);
  }

  // 检查 worktree 存在
  if (!fs.existsSync(statusData.worktreePath)) {
    logger.error(`工作目录不存在: ${statusData.worktreePath}`);
    process.exit(1);
  }

  logger.log("");
  logger.log(chalk.cyan("======================================"));
  logger.log(chalk.bold.cyan("  PR Code Review 监听器"));
  logger.log(chalk.cyan("======================================"));
  logger.log("");
  logger.info(`Issue: #${issueNumber} - ${statusData.title}`);
  logger.info(`PR: #${prNumber}`);
  logger.info(`分支: ${statusData.branchName}`);
  logger.info(`工作目录: ${statusData.worktreePath}`);
  logger.info(`轮询间隔: ${interval}s`);
  logger.log("");

  // 优雅退出
  process.on("SIGINT", () => {
    logger.log("");
    logger.info("收到退出信号，停止审查监听...");
    process.exit(0);
  });

  await pollLoop(
    issueNumber,
    prNumber,
    statusData,
    {
      interval,
      ci: opts.ci,
      detach: opts.detach,
    },
    paths,
  );
}

main().catch((err) => {
  logger.error(`review-watch 异常: ${err.message}\n${err.stack || ""}`);
  process.exit(1);
});
