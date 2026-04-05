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
import { getAgentRole } from "./agent-config";
import { SessionManager } from "./session-manager";
import { SessionPathManager } from "./session-paths";

const logger = consola.withTag("plan-watch");

/**
 * plan-watch.ts - 监听 Issue approved 标签并自动启动实施阶段
 *
 * 流程：
 * 1. 读取 status.json → 校验 status === "awaiting_approval"
 * 2. 轮询 Issue labels，检测 "approved" 标签
 * 3. 检测到后：写入 .along-mode = "phase2" → 启动 Agent 执行 Step 3-5
 * 4. Issue 关闭时优雅退出
 */

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
  options: { ci: boolean },
  paths: SessionPathManager,
): Promise<void> {
  syncPromptsToWorktree(worktreePath);
  ensureEditorPermissions(worktreePath);

  const logTag = config.getLogTag();
  const editor = config.EDITORS.find((e) => e.id === logTag);

  let cmd = editor?.runTemplate || "{tag} --prompt-template {workflow} {num}";
  cmd = cmd
    .replace("{tag}", logTag)
    .replace("{workflow}", "resolve-github-issue")
    .replace("{num}", issueNumber);

  const fullCmd = `cd ${worktreePath} && ${cmd}`;

  logger.info(`启动 Phase 2 Agent (${editor?.name || logTag})...`);
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
  const logTag = config.getLogTag();
  const session = `${logTag}-${issueNumber}`;
  const logFile = paths.getTmuxLogFile();
  const statusFile = paths.getStatusFile();

  const updateStatusScript = `
bun -e "
  const fs = require('fs');
  const f = '${statusFile}';
  const logPath = '${logFile}';
  if (fs.existsSync(f)) {
    const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
    if (s.status === 'running') {
      const exitCode = Number(process.argv[1]) || 0;
      s.status = exitCode === 0 ? 'completed' : 'crashed';
      s.endTime = new Date().toISOString();
      s.lastUpdate = new Date().toISOString();
      if (exitCode !== 0) {
        s.errorMessage = 'Agent 退出码: ' + exitCode;
        s.exitCode = exitCode;
        try {
          if (fs.existsSync(logPath)) {
            const lines = fs.readFileSync(logPath, 'utf-8').split('\\n');
            s.crashLog = lines.slice(-20).join('\\n');
          }
        } catch {}
      }
      fs.writeFileSync(f, JSON.stringify(s, null, 2));
    }
  }
" \${EXIT_CODE} 2>/dev/null || true
  `.trim();

  // 注入 agent 角色和 GitHub token
  const envExports: string[] = [];
  const agentRole = getAgentRole();
  if (agentRole) {
    envExports.push(`export ALONG_AGENT_ROLE='${agentRole}'`);
  }
  const tokenRes = await readGithubToken();
  if (tokenRes.success) {
    envExports.push(`export GH_TOKEN='${tokenRes.data}'`);
  }

  // 将 tmux 脚本写入临时文件，避免 bash -c '...' 的引号嵌套问题
  const scriptContent = `#!/bin/bash
${envExports.join("\n")}
echo "Starting Phase 2 at $(date)" > ${logFile}
${cmd} 2>&1 | tee -a ${logFile}
EXIT_CODE=\${PIPESTATUS[0]}
${updateStatusScript}
if [ \${EXIT_CODE} -ne 0 ]; then
  echo ""
  echo "⚠️ Agent 意外崩溃 (退出码: \${EXIT_CODE})"
  echo "日志已保存到: ${logFile}"
  osascript -e "display notification \\"Phase 2 Agent 异常退出 (退出码: \${EXIT_CODE})\\" with title \\"Along 任务中断\\" subtitle \\"Issue #${issueNumber}\\"" 2>/dev/null || true
  printf "\\a" 2>/dev/null || true
  echo "按 Enter 键关闭当前窗口..."
  read
  exit \${EXIT_CODE}
fi
`;

  const scriptDir = path.dirname(paths.getStatusFile());
  const scriptFile = path.join(scriptDir, `tmux-phase2-${issueNumber}.sh`);
  fs.writeFileSync(scriptFile, scriptContent, { mode: 0o755 });

  await $`tmux new-window -n ${session} ${scriptFile}`;
  logger.success(`Tmux 窗口已创建: ${session}`);
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
  const logTag = config.getLogTag();
  const tmuxWindow = `${logTag}-${issueNumber}`;

  while (true) {
    await Bun.sleep(pollInterval * 1000);

    const status = sessionManager.readStatus();
    if (!status) {
      logger.warn("无法读取 session 状态，继续等待...");
      continue;
    }

    if (status.status !== "running") {
      if (status.status === "completed") {
        logger.success("Phase 2 Agent 处理完成");
      } else {
        logger.warn(`Phase 2 Agent 结束，状态: ${status.status}`);
      }
      return;
    }

    // 检查 tmux 窗口是否还存在
    try {
      const result = await $`tmux list-windows -F '#{window_name}'`.text();
      const alive = result.split("\n").some((line) => line.trim() === tmuxWindow);
      if (!alive) {
        const logFile = paths.getTmuxLogFile();
        let crashLog = "";
        if (fs.existsSync(logFile)) {
          const content = fs.readFileSync(logFile, "utf-8");
          const lines = content.split("\n");
          crashLog = lines.slice(-20).join("\n");
        }

        sessionManager.markAsCrashed(
          "Phase 2 Agent tmux 窗口已关闭，但未更新状态",
          crashLog,
        );
        logger.warn("Phase 2 Agent tmux 窗口已关闭，可能异常退出");
        return;
      }
    } catch {
      // tmux 不可用
    }
  }
}

function hasApprovedLabel(labels: any[]): boolean {
  return labels.some((l: any) => {
    const name = typeof l === "string" ? l : l.name;
    return name === "approved";
  });
}

async function pollLoop(
  issueNumber: string,
  worktreePath: string,
  options: { interval: number; ci: boolean },
  paths: SessionPathManager,
) {
  const tokenRes = await readGithubToken();
  if (!tokenRes.success) {
    logger.error(`GitHub 认证失败: ${tokenRes.error}`);
    process.exit(1);
  }

  const { owner, repo } = { owner: paths.getOwner(), repo: paths.getRepo() };
  const client = new GitHubClient(tokenRes.data, owner, repo);
  const session = new SessionManager(owner, repo, Number(issueNumber));

  logger.info(chalk.bold(`轮询中 (每 ${options.interval}s)... 按 Ctrl+C 退出`));

  let pollCount = 0;
  const startTime = new Date();

  while (true) {
    await Bun.sleep(options.interval * 1000);
    pollCount++;

    try {
      const now = new Date();
      const timeStr = now.toLocaleTimeString("zh-CN", { hour12: false });
      const elapsed = Math.floor((now.getTime() - startTime.getTime()) / 1000);
      const elapsedStr = `${Math.floor(elapsed / 60)}分${elapsed % 60}秒`;

      // 获取 Issue 状态
      const issue = await client.getIssue(Number(issueNumber));

      // Issue 已关闭 → 退出
      if (issue.state === "closed") {
        logger.info(chalk.yellow(`[${timeStr}] Issue 已关闭，停止监听`));
        session.logEvent("issue-closed-during-plan-watch", { issueNumber });
        process.exit(0);
      }

      // 检查 approved 标签
      if (hasApprovedLabel(issue.labels)) {
        logger.log("");
        logger.success(chalk.green(`[${timeStr}] 检测到 approved 标签！启动 Phase 2...`));
        session.logEvent("approved-label-detected", { issueNumber, pollCount, elapsedStr });

        // 写入 .along-mode = "phase2"
        const modeFile = path.join(path.dirname(paths.getStatusFile()), ".along-mode");
        fs.writeFileSync(modeFile, "phase2");
        logger.info("已写入 .along-mode = phase2");

        // 更新 session 状态为 running
        session.writeStatus({
          status: "running",
          currentStep: "Phase 2: 实施计划",
          lastMessage: "检测到 approved 标签，开始实施",
        });

        // 启动 Phase 2 Agent
        session.logEvent("agent-launched", { trigger: "approved-label", phase: 2 });
        await launchAgent(issueNumber, worktreePath, options, paths);

        if (!options.ci) {
          logger.info("等待 Phase 2 Agent 完成...");
          await waitForAgentCompletion(issueNumber, 10, paths);
          session.logEvent("agent-completed", { trigger: "approved-label", phase: 2 });
        }

        logger.success("Phase 2 完成，plan-watch 退出");
        process.exit(0);
      }

      logger.info(
        `[${timeStr}] 轮询中 (第${pollCount}次, 已运行${elapsedStr})... 未检测到 approved 标签`,
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
    .name("plan-watch")
    .description("监听 Issue approved 标签并自动启动实施阶段")
    .argument("<issue-number>", "Issue 编号")
    .option("--interval <seconds>", "轮询间隔（秒）", "30")
    .option("--ci", "CI 模式：跳过 tmux，直接前台执行", false)
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
    logger.error("请先通过 along run --review 创建任务");
    process.exit(1);
  }

  const statusData = JSON.parse(fs.readFileSync(statusFile, "utf-8"));

  // 校验状态：允许 awaiting_approval 或 running（agent 可能还在执行 Phase 1）
  if (statusData.status === "running") {
    logger.info("当前状态为 running，等待 Phase 1 完成...");
    const session = new SessionManager(owner, repo, Number(issueNumber));
    while (true) {
      await Bun.sleep(5000);
      const current = session.readStatus();
      if (!current) {
        logger.error("无法读取 session 状态");
        process.exit(1);
      }
      if (current.status === "awaiting_approval") {
        logger.success("Phase 1 已完成，状态已变为 awaiting_approval");
        break;
      }
      if (current.status !== "running") {
        logger.error(`Phase 1 异常退出，状态: ${current.status}`);
        process.exit(1);
      }
    }
  } else if (statusData.status !== "awaiting_approval") {
    logger.error(`当前状态为 "${statusData.status}"，期望 "awaiting_approval" 或 "running"`);
    logger.error("plan-watch 仅在 Phase 1 执行中或完成后启动");
    process.exit(1);
  }

  // 检查 worktree 存在
  const worktreePath = statusData.worktreePath || paths.getWorktreeDir();
  if (!fs.existsSync(worktreePath)) {
    logger.error(`工作目录不存在: ${worktreePath}`);
    process.exit(1);
  }

  logger.log("");
  logger.log(chalk.cyan("======================================"));
  logger.log(chalk.bold.cyan("  Plan 审批监听器"));
  logger.log(chalk.cyan("======================================"));
  logger.log("");
  logger.info(`Issue: #${issueNumber} - ${statusData.title}`);
  logger.info(`工作目录: ${worktreePath}`);
  logger.info(`轮询间隔: ${interval}s`);
  logger.info(`等待 Issue 添加 ${chalk.magenta("approved")} 标签...`);
  logger.log("");

  // 优雅退出
  process.on("SIGINT", () => {
    logger.log("");
    logger.info("收到退出信号，停止监听...");
    process.exit(0);
  });

  await pollLoop(issueNumber, worktreePath, { interval, ci: opts.ci }, paths);
}

main().catch((err) => {
  logger.error(`plan-watch 异常: ${err.message}\n${err.stack || ""}`);
  process.exit(1);
});
