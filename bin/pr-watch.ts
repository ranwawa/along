#!/usr/bin/env bun
import { $ } from "bun";
import { Command } from "commander";
import fs from "fs";
import path from "path";
import { consola } from "consola";
import chalk from "chalk";
import { iso_timestamp, ensureEditorPermissions } from "./common";
import { GitHubClient, readGithubToken, readRepoInfo } from "./github-client";
import type { GitHubReviewComment, GitHubCheckRun } from "./github-client";
import { config } from "./config";
import { SessionManager } from "./session-manager";
import { cleanupIssue } from "./cleanup-utils";
import { SessionPathManager } from "./session-paths";

const logger = consola.withTag("pr-watch");

/**
 * pr-watch.ts - 监听 PR 评论和 CI 状态并自动触发 Agent 处理
 *
 * 流程：
 * 1. 读取 status.json → 获取 prUrl/branchName, worktreePath, repo
 * 2. 解析 PR number（从 prUrl 或通过 branch 查找）
 * 3. 获取当前所有 review comments → 记录 lastSeenIds
 * 4. 轮询循环：
 *    - 检测 PR 合并/关闭 → 清理退出
 *    - 检测 CI 失败 → 写入失败信息 → 启动 agent 修复
 *    - 检测新评论 → 写入 comments.json → 启动 agent 处理
 * 5. Ctrl+C 优雅退出
 */

interface StatusData {
  issueNumber: number;
  status: string;
  branchName: string;
  worktreePath: string;
  title: string;
  repo: { owner: string; name: string };
  prUrl?: string;
  [key: string]: any;
}

async function resolvePrNumber(statusData: StatusData): Promise<number> {
  // 优先从 prUrl 解析
  if (statusData.prUrl) {
    const match = statusData.prUrl.match(/\/pull\/(\d+)/);
    if (match) return Number(match[1]);
  }

  // fallback: 通过 branch name 查找 PR
  const { owner, name } = statusData.repo;
  logger.info(`prUrl 不存在，通过分支 ${statusData.branchName} 查找 PR...`);

  const result =
    await $`gh pr list --repo ${owner}/${name} --head ${statusData.branchName} --json number --jq '.[0].number'`.text();
  const prNumber = Number(result.trim());

  if (!prNumber || isNaN(prNumber)) {
    throw new Error(`无法找到分支 ${statusData.branchName} 对应的 PR`);
  }

  return prNumber;
}

function writeCommentsFile(
  paths: SessionPathManager,
  comments: GitHubReviewComment[],
  prNumber: number,
  repo: { owner: string; name: string },
): string {
  const filePath = paths.getPrCommentsFile();
  const data = {
    meta: {
      owner: repo.owner,
      repo: repo.name,
      pr_number: prNumber,
      fetched_at: iso_timestamp(),
    },
    comments: comments.map((c) => ({
      id: c.id,
      user: c.user?.login,
      path: c.path,
      line: c.line || c.original_line,
      side: c.side,
      body: c.body,
      diff_hunk: c.diff_hunk,
      created_at: c.created_at,
      in_reply_to_id: c.in_reply_to_id,
    })),
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

function writeCiFailureFile(
  paths: SessionPathManager,
  failedRuns: GitHubCheckRun[],
  headSha: string,
  repo: { owner: string; name: string },
): string {
  const filePath = paths.getCiFailuresFile();
  const data = {
    meta: {
      owner: repo.owner,
      repo: repo.name,
      head_sha: headSha,
      fetched_at: iso_timestamp(),
    },
    failed_checks: failedRuns.map((r) => ({
      id: r.id,
      name: r.name,
      conclusion: r.conclusion,
      html_url: r.html_url,
      details_url: r.details_url,
      started_at: r.started_at,
      completed_at: r.completed_at,
      output_title: r.output?.title,
      output_summary: r.output?.summary,
    })),
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
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

async function launchAgent(
  issueNumber: string,
  worktreePath: string,
  options: { ci: boolean; detach: boolean },
  paths: SessionPathManager,
  workflow: string = "resolve-pr-review",
): Promise<void> {
  // 每次启动 agent 前同步最新的 prompts/skills 到 worktree
  syncPromptsToWorktree(worktreePath);
  ensureEditorPermissions(worktreePath);

  const logTag = config.getLogTag();
  const editor = config.EDITORS.find((e) => e.id === logTag);

  let cmd = editor?.runTemplate || "{tag} --prompt-template {workflow} {num}";
  cmd = cmd
    .replace("{tag}", logTag)
    .replace("{workflow}", workflow)
    .replace("{num}", issueNumber);

  const fullCmd = `cd ${worktreePath} && ${cmd}`;

  logger.info(`启动 Agent 处理评论 (${editor?.name || logTag})...`);
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
    logger.warn(`Agent 退出码: ${exitCode}`);
  }
}

async function execAgentTmux(
  cmd: string,
  issueNumber: string,
  paths: SessionPathManager,
): Promise<void> {
  const session = `pr-review-${issueNumber}`;
  const logFile = paths.getPrReviewTmuxLogFile();
  const statusFile = paths.getStatusFile();

  // Agent 完成后通过 bun 脚本更新 status.json，确保主窗口能检测到完成/崩溃
  const updateStatusScript = `
    bun -e "
      const fs = require('fs');
      const f = '${statusFile}';
      if (fs.existsSync(f)) {
        const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
        if (s.status === 'running') {
          const exitCode = Number(process.argv[1]) || 0;
          s.status = exitCode === 0 ? 'completed' : 'crashed';
          s.endTime = new Date().toISOString();
          s.lastUpdate = new Date().toISOString();
          if (exitCode !== 0) s.errorMessage = 'Agent 退出码: ' + exitCode;
          fs.writeFileSync(f, JSON.stringify(s, null, 2));
        }
      }
    "
  `.trim();

  const safeCmd = `bash -c '
    echo "Starting PR review at $(date)" > ${logFile}
    ${cmd.replace(/'/g, "'\\''")} 2>&1 | tee -a ${logFile}
    EXIT_CODE=\${PIPESTATUS[0]}
    ${updateStatusScript} \${EXIT_CODE} 2>/dev/null || true
    if [ \${EXIT_CODE} -ne 0 ]; then
      echo ""
      echo "⚠️ Agent 意外崩溃 (退出码: \${EXIT_CODE})"
      echo "日志已保存到: ${logFile}"
      echo "按 Enter 键关闭当前窗口..."
      read
      exit \${EXIT_CODE}
    fi
  '`;

  await $`tmux new-window -n ${session} ${safeCmd}`;
  logger.success(`Tmux 窗口已创建: ${session}`);
}

async function isTmuxWindowAlive(windowName: string): Promise<boolean> {
  try {
    const result = await $`tmux list-windows -F '#{window_name}'`.text();
    return result.split("\n").some((line) => line.trim() === windowName);
  } catch {
    return false;
  }
}

async function waitForAgentCompletion(
  issueNumber: string,
  pollInterval: number,
  paths: SessionPathManager,
): Promise<void> {
  const sessionManager = new SessionManager(
    paths.getOwner(),
    paths.getRepo(),
    Number(issueNumber),
  );
  const tmuxWindow = `pr-review-${issueNumber}`;

  while (true) {
    await Bun.sleep(pollInterval * 1000);

    const status = sessionManager.readStatus();
    if (!status) {
      logger.warn("无法读取 session 状态，继续等待...");
      continue;
    }

    if (status.status !== "running") {
      if (status.status === "completed") {
        logger.success("Agent 处理完成");
      } else {
        logger.warn(`Agent 结束，状态: ${status.status}`);
      }
      return;
    }

    // 检查 tmux 窗口是否还存在，如果窗口已关闭但状态仍为 running，说明 agent 异常退出
    const alive = await isTmuxWindowAlive(tmuxWindow);
    if (!alive) {
      // 读取日志文件获取退出信息
      const logFile = paths.getPrReviewTmuxLogFile();
      let crashLog = "";
      if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, "utf-8");
        const lines = content.split("\n");
        crashLog = lines.slice(-20).join("\n");
      }

      sessionManager.markAsCrashed(
        "Agent tmux 窗口已关闭，但未更新状态",
        crashLog,
      );
      logger.warn("Agent tmux 窗口已关闭，可能异常退出");
      if (crashLog) {
        logger.info(`最近日志:\n${crashLog}`);
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

  // 获取当前所有评论，建立 baseline
  logger.info("获取当前 PR 评论...");
  const existingComments = await client.getReviewComments(prNumber);
  const lastSeenIds = new Set(existingComments.map((c) => c.id));
  logger.info(`当前已有 ${lastSeenIds.size} 条评论`);

  // 检查是否有未解决的评论（顶层评论且没有回复）
  const repliedToIds = new Set(
    existingComments
      .filter((c) => c.in_reply_to_id)
      .map((c) => c.in_reply_to_id),
  );
  const unresolvedComments = existingComments.filter(
    (c) => !c.in_reply_to_id && !repliedToIds.has(c.id),
  );

  if (unresolvedComments.length > 0) {
    logger.info(
      chalk.yellow(
        `发现 ${unresolvedComments.length} 条未解决的评论，立即处理...`,
      ),
    );

    for (const c of unresolvedComments) {
      logger.info(
        `  - [${c.user?.login}] ${c.path}:${c.line || c.original_line}: ${c.body.slice(0, 80)}`,
      );
    }

    const commentsFile = writeCommentsFile(
      paths,
      unresolvedComments,
      prNumber,
      statusData.repo,
    );
    logger.info(`评论已写入: ${commentsFile}`);

    const sessionManager = new SessionManager(
      paths.getOwner(),
      paths.getRepo(),
      Number(issueNumber),
    );
    sessionManager.writeStatus({
      status: "running",
      currentStep: "处理 PR 评论",
      lastMessage: `发现 ${unresolvedComments.length} 条未解决的评论`,
    });

    await launchAgent(issueNumber, statusData.worktreePath, options, paths);

    if (!options.ci) {
      logger.info("等待 Agent 完成...");
      await waitForAgentCompletion(issueNumber, 10, paths);
    }

    // 更新 lastSeenIds（包含 agent 可能产生的回复）
    const updatedComments = await client.getReviewComments(prNumber);
    for (const c of updatedComments) {
      lastSeenIds.add(c.id);
    }

    logger.info("未解决评论处理完毕");
  } else {
    logger.info("没有未解决的评论，开始监听新评论...");
  }

  // 初始 CI 状态检查
  logger.info("检查当前 CI 状态...");
  const pr = await client.getPullRequest(prNumber);
  const headSha = pr.head.sha;
  const checkRuns = await client.getCheckRuns(headSha);
  let lastProcessedSha = "";

  if (checkRuns.length > 0) {
    const failedRuns = checkRuns.filter(
      (r) => r.conclusion === "failure" || r.conclusion === "timed_out",
    );
    const pendingRuns = checkRuns.filter(
      (r) => r.status === "in_progress" || r.status === "queued",
    );

    if (failedRuns.length > 0) {
      logger.info(
        chalk.red(`发现 ${failedRuns.length} 个 CI 检查失败，立即修复...`),
      );

      for (const r of failedRuns) {
        logger.info(`  - ${r.name}: ${r.conclusion} (${r.html_url})`);
      }

      const ciFile = writeCiFailureFile(
        paths,
        failedRuns,
        headSha,
        statusData.repo,
      );
      logger.info(`CI 失败信息已写入: ${ciFile}`);

      const sessionManager = new SessionManager(
        paths.getOwner(),
        paths.getRepo(),
        Number(issueNumber),
      );
      sessionManager.writeStatus({
        status: "running",
        currentStep: "修复 CI 失败",
        lastMessage: `发现 ${failedRuns.length} 个 CI 检查失败`,
      });

      await launchAgent(
        issueNumber,
        statusData.worktreePath,
        options,
        paths,
        "resolve-ci-failure",
      );

      if (!options.ci) {
        logger.info("等待 Agent 完成...");
        await waitForAgentCompletion(issueNumber, 10, paths);
      }

      lastProcessedSha = headSha;
      logger.info("初始 CI 失败处理完毕");
    } else if (pendingRuns.length > 0) {
      logger.info(`CI 检查进行中 (${pendingRuns.length} 个待完成)...`);
    } else {
      logger.info("CI 检查全部通过");
    }
  } else {
    logger.info("暂无 CI 检查记录");
  }

  logger.log("");
  logger.info(chalk.bold(`轮询中 (每 ${options.interval}s)... 按 Ctrl+C 退出`));

  let pollCount = 0;
  const startTime = new Date();

  while (true) {
    await Bun.sleep(options.interval * 1000);
    pollCount++;

    try {
      // 检查 PR 状态
      const pr = await client.getPullRequest(prNumber);
      const now = new Date();
      const timeStr = now.toLocaleTimeString("zh-CN", { hour12: false });
      const elapsed = Math.floor((now.getTime() - startTime.getTime()) / 1000);
      const elapsedStr = `${Math.floor(elapsed / 60)}分${elapsed % 60}秒`;

      if (pr.state === "closed" || pr.merged) {
        logger.log("");
        if (pr.merged) {
          logger.success(chalk.green(`[${timeStr}] PR 已合并！`));
        } else {
          logger.info(chalk.yellow(`[${timeStr}] PR 已关闭`));
        }

        // PR 合并时移除 WIP 标签
        if (pr.merged) {
          try {
            await client.removeIssueLabel(Number(issueNumber), "WIP");
            logger.success("WIP 标签已移除");
          } catch (e: any) {
            logger.warn(`移除 WIP 标签失败: ${e.message}`);
          }
        }

        // 更新 session 状态为 completed
        try {
          const sessionManager = new SessionManager(
            paths.getOwner(),
            paths.getRepo(),
            Number(issueNumber),
          );
          sessionManager.writeStatus({
            status: "completed",
            currentStep: "PR 已处理完毕",
            lastMessage: pr.merged ? "PR 已合并" : "PR 已关闭",
          });
        } catch (e: any) {
          logger.warn(`更新 session 状态失败: ${e.message}`);
        }

        // 执行 cleanup
        try {
          logger.info("开始清理资源...");
          await cleanupIssue(
            issueNumber,
            { reason: pr.merged ? "pr-merged" : "pr-closed" },
            paths.getOwner(),
            paths.getRepo(),
          );
          logger.success("清理完成");
        } catch (e: any) {
          logger.warn(`清理资源失败: ${e.message}`);
        }

        // 优雅退出 - 无论清理是否成功都必须退出
        logger.info("Bye!");
        process.exit(0);
      }

      // 检查 CI 状态
      const headSha = pr.head.sha;
      const checkRuns = await client.getCheckRuns(headSha);

      if (checkRuns.length > 0) {
        const failedRuns = checkRuns.filter(
          (r) => r.conclusion === "failure" || r.conclusion === "timed_out",
        );
        const pendingRuns = checkRuns.filter(
          (r) => r.status === "in_progress" || r.status === "queued",
        );

        if (failedRuns.length > 0 && headSha !== lastProcessedSha) {
          logger.log("");
          logger.info(
            chalk.red(
              `[${timeStr}] 检测到 ${failedRuns.length} 个 CI 检查失败！`,
            ),
          );

          for (const r of failedRuns) {
            logger.info(`  - ${r.name}: ${r.conclusion} (${r.html_url})`);
          }

          // 写入 CI 失败信息供 agent 读取
          const ciFile = writeCiFailureFile(
            paths,
            failedRuns,
            headSha,
            statusData.repo,
          );
          logger.info(`CI 失败信息已写入: ${ciFile}`);

          // 重置 session 状态为 running
          const sessionManager = new SessionManager(
            paths.getOwner(),
            paths.getRepo(),
            Number(issueNumber),
          );
          sessionManager.writeStatus({
            status: "running",
            currentStep: "修复 CI 失败",
            lastMessage: `检测到 ${failedRuns.length} 个 CI 检查失败`,
          });

          // 启动 agent 修复 CI 失败
          await launchAgent(
            issueNumber,
            statusData.worktreePath,
            options,
            paths,
            "resolve-ci-failure",
          );

          if (!options.ci) {
            logger.info("等待 Agent 完成...");
            await waitForAgentCompletion(issueNumber, 10, paths);
          }

          lastProcessedSha = headSha;

          logger.log("");
          logger.info(
            chalk.bold(
              `Agent 处理完毕，继续监听 (每 ${options.interval}s)... 按 Ctrl+C 退出`,
            ),
          );
          continue;
        } else if (pendingRuns.length > 0 && failedRuns.length === 0) {
          logger.info(
            `[${timeStr}] CI 检查进行中 (${pendingRuns.length} 个待完成)...`,
          );
        }
      }

      // 检查新评论
      const allComments = await client.getReviewComments(prNumber);
      const newComments = allComments.filter((c) => !lastSeenIds.has(c.id));

      if (newComments.length === 0) {
        logger.info(
          `[${timeStr}] 轮询中 (第${pollCount}次, 已运行${elapsedStr})... 无新评论`,
        );
        continue;
      }

      logger.log("");
      logger.info(
        chalk.yellow(`[${timeStr}] 检测到 ${newComments.length} 条新评论！`),
      );

      for (const c of newComments) {
        logger.info(
          `  - [${c.user?.login}] ${c.path}:${c.line || c.original_line}: ${c.body.slice(0, 80)}`,
        );
      }

      // 写入评论文件供 agent 读取
      const commentsFile = writeCommentsFile(
        paths,
        newComments,
        prNumber,
        statusData.repo,
      );
      logger.info(`评论已写入: ${commentsFile}`);

      // 重置 session 状态为 running（agent 会更新它）
      const sessionManager = new SessionManager(
        paths.getOwner(),
        paths.getRepo(),
        Number(issueNumber),
      );
      sessionManager.writeStatus({
        status: "running",
        currentStep: "处理 PR 评论",
        lastMessage: `检测到 ${newComments.length} 条新评论`,
      });

      // 启动 agent
      await launchAgent(issueNumber, statusData.worktreePath, options, paths);

      // CI 模式下 agent 是同步的，已经执行完毕
      // tmux 模式下需要轮询等待 agent 完成
      if (!options.ci) {
        logger.info("等待 Agent 完成...");
        await waitForAgentCompletion(issueNumber, 10, paths);
      }

      // 更新 lastSeenIds（包含 agent 可能产生的回复）
      const updatedComments = await client.getReviewComments(prNumber);
      for (const c of updatedComments) {
        lastSeenIds.add(c.id);
      }

      logger.log("");
      logger.info(
        chalk.bold(
          `Agent 处理完毕，继续监听 (每 ${options.interval}s)... 按 Ctrl+C 退出`,
        ),
      );
    } catch (error: any) {
      const timeStr = new Date().toLocaleTimeString("zh-CN", { hour12: false });
      logger.error(`[${timeStr}] 轮询出错: ${error.message}`);
      logger.info("将在下一轮继续...");
    }
  }
}

async function main() {
  const program = new Command();
  program
    .name("pr-watch")
    .description("监听 PR 评论和 CI 状态并自动触发 Agent 处理")
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

  // 启动前检查 PR 是否已合并或关闭
  const tokenRes = await readGithubToken();
  if (!tokenRes.success) {
    logger.error(`GitHub 认证失败: ${tokenRes.error}`);
    process.exit(1);
  }
  const preCheckClient = new GitHubClient(tokenRes.data, owner, repo);
  const prInfo = await preCheckClient.getPullRequest(prNumber);

  if (prInfo.merged) {
    logger.success(`PR #${prNumber} 已合并，无需监听`);

    const sessionManager = new SessionManager(owner, repo, Number(issueNumber));
    sessionManager.writeStatus({
      status: "completed",
      currentStep: "PR 已处理完毕",
      lastMessage: "PR 已合并",
    });

    logger.info("开始清理资源...");
    await cleanupIssue(issueNumber, { reason: "pr-merged" }, owner, repo);
    logger.success("清理完成");
    process.exit(0);
  }

  if (prInfo.state === "closed") {
    logger.info(`PR #${prNumber} 已关闭（未合并），无需监听`);
    process.exit(0);
  }

  // 检查 worktree 存在（仅在需要实际监听时才检查）
  if (!fs.existsSync(statusData.worktreePath)) {
    logger.error(`工作目录不存在: ${statusData.worktreePath}`);
    process.exit(1);
  }

  logger.log("");
  logger.log(chalk.cyan("======================================"));
  logger.log(chalk.bold.cyan("  PR Review & CI 监听器"));
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
    logger.info("收到退出信号，停止监听...");
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
  logger.error(`pr-watch 异常: ${err.message}`);
  process.exit(1);
});
