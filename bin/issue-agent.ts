/**
 * issue-agent.ts - Issue Agent 共享启动模块
 *
 * 提供 launchIssueAgent() 作为核心入口，供 webhook-server 和 CLI (run.ts) 共同调用。
 * 将 worktree 初始化、session 管理、.along-mode 写入、agent 执行等逻辑统一封装。
 */

import fs from "fs";
import path from "path";
import { consola } from "consola";
import { iso_timestamp, ensureEditorPermissions, git } from "./common";
import { config } from "./config";
import { SessionManager } from "./session-manager";
import { SessionPathManager } from "./session-paths";
import { setupWorktree, initSessionFiles } from "./worktree-init";
import { getAgentRole } from "./agent-config";

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
export function syncPromptsToWorktree(worktreePath: string): void {
  const logTag = config.getLogTag();
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
): Promise<number> {
  syncPromptsToWorktree(worktreePath);
  ensureEditorPermissions(worktreePath);

  const logTag = config.getLogTag();
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
  return exitCode;
}

// ─── launchIssueAgent ───────────────────────────────────────

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
  taskData?: { title: string },
): Promise<void> {
  const paths = new SessionPathManager(owner, repo, issueNumber);
  const session = new SessionManager(owner, repo, issueNumber);

  logger.info(`启动 Issue #${issueNumber} Agent (${phase})...`);
  session.logEvent("issue-agent-launch", { phase, issueNumber });

  // 1. 获取 Issue 数据
  let title = taskData?.title || "";
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
      throw new Error(wtResult.error);
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
      const tag = config.getLogTag();
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

  try {
    const logFile = paths.getTmuxLogFile();
    const exitCode = await execAgent(worktreePath, issueNumber, workflow, (pid) => {
      session.writeStatus({ pid });
    }, logFile);

    if (exitCode !== 0) {
      session.markAsError(`Agent 退出码: ${exitCode}`, exitCode);
    } else {
      session.markAsCompleted();
    }
  } catch (error: any) {
    session.markAsCrashed(error.message, error.stack);
    throw error;
  }
}
