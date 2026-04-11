/**
 * issue-agent.ts - Issue Agent 共享启动模块
 *
 * 提供 launchIssueAgent() 作为核心入口，供 webhook-server 和 CLI (run.ts) 共同调用。
 * 将 worktree 初始化、session 管理、.along-mode 写入、agent 执行等逻辑统一封装。
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import chalk from "chalk";
import { consola } from "consola";
import {
  iso_timestamp,
  ensureEditorPermissions,
  git,
  success,
  failure,
  check_process_running,
} from "./common";
import type { Result } from "./common";
import { config } from "./config";
import { SessionManager } from "./session-manager";
import { SessionPathManager } from "./session-paths";
import { setupWorktree, initSessionFiles } from "./worktree-init";
import { getAgentRole } from "./agent-config";
import { readGithubToken, get_gh_client } from "./github-client";
import { readSession } from "./db";
import { $ } from "bun";

/** 是否启用 Dashboard 模式（启用时 agent 输出写入日志文件而非 stdout） */
let _dashboardMode = false;
export function setDashboardMode(enabled: boolean): void {
  _dashboardMode = enabled;
}

const logger = consola.withTag("issue-agent");

// ─── syncPromptsToWorktree ─────────────────────────────────

/**
 * 将 prompts/skills 同步到 worktree（增量覆盖，不删除已有文件）
 * 用于 webhook 触发的二次同步（worktree 已存在时刷新 prompt 内容）
 */
export function syncPromptsToWorktree(worktreePath: string): Result<void> {
  const logTagRes = config.getLogTag();
  if (!logTagRes.success) return logTagRes;
  const logTag = logTagRes.data;

  const editor = config.EDITORS.find((e) => e.id === logTag) || config.EDITORS[0];

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
  return success(undefined);
}

// ─── execAgent ──────────────────────────────────────────────

type WritableTarget = { write(data: string): any };

async function drainStream(stream: ReadableStream<Uint8Array>, out: WritableTarget): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out.write(decoder.decode(value));
  }
}

export async function execAgent(
  worktreePath: string,
  issueNumber: number,
  workflow: string,
  onPid?: (pid: number) => void,
  logFile?: string,
): Promise<Result<number>> {
  const syncRes = syncPromptsToWorktree(worktreePath);
  if (!syncRes.success) return syncRes;

  ensureEditorPermissions(worktreePath);

  const logTagRes = config.getLogTag();
  if (!logTagRes.success) return logTagRes;
  const logTag = logTagRes.data;
  const editor = config.EDITORS.find((e) => e.id === logTag);

  let cmd = editor?.runTemplate || "{tag} --prompt-template {workflow} {num}";
  cmd = cmd
    .replace("{tag}", logTag)
    .replace("{workflow}", workflow)
    .replace("{num}", String(issueNumber));

  logger.info(`启动 Agent (${editor?.name || logTag}), workflow: ${workflow}`);
  logger.info(`执行命令: ${cmd}`);

  const proc = Bun.spawn(["bash", "-c", cmd], {
    cwd: worktreePath,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (onPid && proc.pid) {
    onPid(proc.pid);
  }

  // Dashboard 模式下将 agent 输出写入日志文件，避免破坏 Ink 渲染
  const targetLogFile = _dashboardMode ? logFile : undefined;
  let fileHandle: { write(data: string): any; end(): void } | undefined;

  if (targetLogFile) {
    const ws = fs.createWriteStream(targetLogFile, { flags: "a" });
    fileHandle = ws;
  }

  const out: WritableTarget = fileHandle || process.stdout;
  const err: WritableTarget = fileHandle || process.stderr;

  try {
    await Promise.all([
      proc.stdout ? drainStream(proc.stdout, out) : Promise.resolve(),
      proc.stderr ? drainStream(proc.stderr, err) : Promise.resolve(),
    ]);
  } finally {
    fileHandle?.end();
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    logger.warn(`Agent 退出码: ${exitCode}`);
  }
  return success(exitCode);
}

// ─── execTmux ──────────────────────────────────────────────

export async function execTmux(
  worktreePath: string,
  issueNumber: number,
  paths: SessionPathManager,
  sessionManager: SessionManager,
  options: {
    tmuxSessionName?: string;
    detach?: boolean;
    workflow: string;
  },
): Promise<Result<void>> {
  const logTagRes = config.getLogTag();
  if (!logTagRes.success) return logTagRes;
  const tag = logTagRes.data;

  const num = String(issueNumber);
  const session = options.tmuxSessionName || `${tag}-${num}`;
  logger.info(`在 tmux 中创建新窗口并自动切换到会话: ${session}...`);

  // 构建需要注入到 tmux 环境中的变量
  const envExports: string[] = [];
  const agentRole = getAgentRole();
  if (agentRole) {
    envExports.push(`export ALONG_AGENT_ROLE='${agentRole}'`);
  }
  const tokenRes = await readGithubToken();
  if (tokenRes.success) {
    envExports.push(`export GH_TOKEN='${tokenRes.data}'`);
  }

  // 日志文件路径
  const logFile = paths.getAgentLogFile();
  const owner = paths.getOwner();
  const repo = paths.getRepo();

  const editor = config.EDITORS.find((e) => e.id === tag);
  let cmd = editor?.runTemplate || "{tag} --prompt-template {workflow} {num}";
  cmd = cmd
    .replace("{tag}", tag)
    .replace("{workflow}", options.workflow)
    .replace("{num}", num);

  // Agent 完成后导出会话数据
  const exportBinPath = path.join(config.BIN_DIR, "agent-session-export.ts");
  const exportSessionScript = `
bun -e "
  const { exportAgentSession } = require('${exportBinPath}');
  const { SessionPathManager } = require('${path.join(config.BIN_DIR, "session-paths.ts")}');
  const paths = new SessionPathManager('${owner}', '${repo}', ${num});
  exportAgentSession(paths, '${worktreePath}').catch(() => {});
" 2>/dev/null || true
  `.trim();

  // Agent 完成后更新数据库
  const finalizeBinPath = path.join(config.BIN_DIR, "session-finalize.ts");
  const updateStatusScript = `bun ${finalizeBinPath} '${owner}' '${repo}' ${issueNumber} \${EXIT_CODE} '${logFile}' 2>/dev/null || true`;

  // 启动时将 shell PID 写入数据库
  const pidBinPath = path.join(config.BIN_DIR, "session-update-pid.ts");
  const writePidScript = `bun ${pidBinPath} '${owner}' '${repo}' ${issueNumber} $$ 2>/dev/null || true`;

  const scriptContent = `#!/bin/bash
${envExports.join("\n")}
echo "Starting at $(date)" > ${logFile}
${writePidScript}
cd ${worktreePath} && ${cmd} 2>&1 | tee -a ${logFile}
EXIT_CODE=\${PIPESTATUS[0]}
${exportSessionScript}
${updateStatusScript}
if [ \${EXIT_CODE} -ne 0 ]; then
  echo ""
  echo "⚠️ Agent 意外崩溃 (退出码: \${EXIT_CODE})"
  echo "日志已保存到: ${logFile}"
  osascript -e "display notification \\"Agent 异常退出 (退出码: \${EXIT_CODE})\\" with title \\"Along 任务中断\\" subtitle \\"Issue #${num}\\"" 2>/dev/null || true
  printf "\\a" 2>/dev/null || true
  echo "按 Enter 键关闭当前窗口..."
  read
  exit \${EXIT_CODE}
fi
`;

  const issueDir = paths.getIssueDir();
  const scriptFile = path.join(issueDir, `tmux-run-${num}.sh`);
  const ensureRes = paths.ensureDir();
  if (!ensureRes.success) return ensureRes;

  try {
    fs.writeFileSync(scriptFile, scriptContent, { mode: 0o755 });
  } catch (e: any) {
    return failure(`无法写入 tmux 脚本文件: ${e.message}`);
  }

  try {
    await $`tmux new-window -n ${session} ${scriptFile}`;

    if (!options.detach) {
      await $`tmux select-window -t ${session}`;
    } else {
      logger.success(`Tmux 窗口已创建并在后台运行: ${session}`);
      sessionManager.log(`Tmux window created and running in background: ${session}`);
    }
    return success(undefined);
  } catch (error: any) {
    const errorMsg = `Failed to create tmux window: ${error.message}`;
    logger.error(errorMsg);
    sessionManager.markAsCrashed(errorMsg, error.stack);
    return failure(errorMsg, error.stack);
  }
}

// ─── launchIssueAgent ───────────────────────────────────────

export interface LaunchIssueAgentOptions {
  strategy?: "direct" | "tmux";
  tmuxSessionName?: string;
  detach?: boolean;
  taskData?: { title: string };
}

/**
 * 启动 Issue Agent（核心入口，webhook 和 CLI 共用）
 *
 * 1. 获取 Issue 数据（如未提供）
 * 2. 创建 worktree + 初始化 session 文件
 * 3. 写入 .along-mode 文件
 * 4. 启动 agent 进程（CI 模式，前台阻塞）
 */
export async function launchIssueAgent(
  owner: string,
  repo: string,
  issueNumber: number,
  phase: "phase1" | "phase2",
  options: LaunchIssueAgentOptions = {},
): Promise<Result<void>> {
  const paths = new SessionPathManager(owner, repo, issueNumber);
  const session = new SessionManager(owner, repo, issueNumber);

  logger.info(`启动 Issue #${issueNumber} Agent (${phase})...`);
  session.logEvent("issue-agent-launch", { phase, issueNumber });

  // 1. 获取 Issue 数据
  let title = options.taskData?.title || "";
  if (!title) {
    const issueFile = paths.getIssueFile();
    if (fs.existsSync(issueFile)) {
      try {
        const issueData = JSON.parse(fs.readFileSync(issueFile, "utf-8"));
        title = issueData.title || `Issue #${issueNumber}`;
      } catch {
        title = `Issue #${issueNumber}`;
      }
    } else {
      title = `Issue #${issueNumber}`;
    }
  }

  // 2. 确保 worktree 存在
  const worktreePath = paths.getWorktreeDir();
  if (!fs.existsSync(worktreePath)) {
    logger.info("工作目录不存在，初始化 worktree...");

    const wtResult = await setupWorktree(worktreePath, session);
    if (!wtResult.success) {
      session.markAsError(`worktree 创建失败: ${wtResult.error}`);
      return failure(wtResult.error);
    }

    const statusData: Record<string, any> = {
      issueNumber,
      status: "running",
      startTime: iso_timestamp(),
      branchName: "",
      worktreePath,
      title,
      repo: { owner, name: repo },
    };

    const agentRole = getAgentRole();
    if (agentRole) {
      statusData.agentRole = agentRole;
    }

    try {
      const tagRes = config.getLogTag();
      const tag = tagRes.success ? tagRes.data : "unknown";
      const gitHeadSha = (await git.raw(["rev-parse", "HEAD"])).trim();
      const pkg = JSON.parse(fs.readFileSync(path.join(config.ROOT_DIR, "package.json"), "utf-8"));
      statusData.agentType = tag;
      statusData.environment = {
        agentType: tag,
        gitHeadSha,
        alongVersion: pkg.version || "unknown",
        nodeVersion: process.version,
        platform: process.platform,
      };
    } catch (e: any) {
      logger.warn(`记录环境信息失败: ${e.message}`);
    }

    await initSessionFiles(paths, worktreePath, statusData, session);
    logger.success("worktree 初始化完成");
  } else {
    // worktree 已存在，更新状态为 running
    session.writeStatus({ status: "running", lastUpdate: iso_timestamp() });
  }

  ensureEditorPermissions(worktreePath);

  // 3. 写入 .along-mode 文件
  const modeFile = path.join(paths.getIssueDir(), ".along-mode");
  fs.writeFileSync(modeFile, phase);
  logger.info(`执行模式: ${phase} (已写入 .along-mode)`);
  session.logEvent("along-mode-written", { phase, modeFile });

  // 4. 启动 agent
  const workflow = "resolve-github-issue";
  session.updateStep("启动 Agent", `phase=${phase}, workflow=${workflow}`);

  if (options.strategy === "tmux") {
    return execTmux(worktreePath, issueNumber, paths, session, {
      tmuxSessionName: options.tmuxSessionName,
      detach: options.detach,
      workflow,
    });
  }

  try {
    const logFile = paths.getAgentLogFile();
    const agentRes = await execAgent(
      worktreePath,
      issueNumber,
      workflow,
      (pid) => {
        session.writeStatus({ pid });
      },
      logFile,
    );

    if (!agentRes.success) return agentRes;
    const exitCode = agentRes.data;

    if (exitCode !== 0) {
      session.markAsError(`Agent 退出码: ${exitCode}`, exitCode);
    } else {
      session.markAsCompleted();
    }
    return success(undefined);
  } catch (error: any) {
    session.markAsCrashed(error.message, error.stack);
    return failure(error.message, error.stack);
  }
}

/**
 * WIP 标签智能恢复：当 Issue 带有 WIP 标签但对应的 tmux 窗口已不存在且进程已退出时，
 * 自动清理 WIP 标签，允许用户重新启动任务
 */
export async function tryRecoverFromWip(
  owner: string,
  repo: string,
  taskNo: number,
  paths: SessionPathManager,
): Promise<boolean> {
  // 检查 tmux 窗口是否存在
  const tmuxWindowSuffix = `-${taskNo}`;
  let windowAlive = false;
  try {
    const output = execSync("tmux list-windows -a -F '#{window_name}'", {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    windowAlive = output
      .split("\n")
      .some((w) => w.trim().endsWith(tmuxWindowSuffix));
  } catch {
    // tmux 不可用，视为窗口不存在
  }

  if (windowAlive) {
    logger.warn(`Issue #${taskNo} 的 tmux 窗口仍在运行，无法自动恢复`);
    return false;
  }

  // 检查数据库中的 PID 是否存活
  const sessionDataRes = readSession(owner, repo, taskNo);
  if (sessionDataRes.success && sessionDataRes.data) {
    const sessionData = sessionDataRes.data;
    if (sessionData.pid && (await check_process_running(sessionData.pid))) {
      logger.warn(
        `Issue #${taskNo} 的进程 (PID: ${sessionData.pid}) 仍在运行，无法自动恢复`,
      );
      return false;
    }
  }

  // tmux 窗口不存在且进程已退出，自动清理 WIP 标签
  logger.warn(
    `Issue #${taskNo} 的 WIP 标签残留（tmux 窗口已关闭、进程已退出），正在自动清理...`,
  );
  try {
    const clientRes = await get_gh_client();
    if (clientRes.success) {
      await clientRes.data.removeIssueLabel(taskNo, "WIP");
      logger.success(`Issue #${taskNo} 的 WIP 标签已自动清理，任务将重新启动`);
      return true;
    }
  } catch (e: any) {
    logger.warn(`自动清理 WIP 标签失败: ${e.message}`);
  }
  return false;
}
