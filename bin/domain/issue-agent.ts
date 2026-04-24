/**
 * issue-agent.ts - Issue Agent 共享启动模块
 *
 * 提供 launchIssueAgent() 作为核心入口，供 webhook-server 和 CLI (run.ts) 共同调用。
 * 将 worktree 初始化、session 管理、.along-mode 写入、agent 执行等逻辑统一封装。
 */

import fs from "fs";
import path from "path";
import { consola } from "consola";
import {
  iso_timestamp,
  ensureEditorPermissions,
  git,
  getGit,
  success,
  failure,
  check_process_running,
  get_repo_root,
} from "../core/common";
import type { Result } from "../core/common";
import { config } from "../core/config";
import { SessionManager } from "./session-manager";
import { SessionPathManager } from "../core/session-paths";
import {
  setupWorktree,
  setupPlanningWorkspace,
  initSessionFiles,
  initPlanningSession,
  syncEditorMappings,
} from "./worktree-init";
import { getAgentRole } from "../integration/agent-config";
import { get_gh_client } from "../integration/github-client";
import { readSession } from "../core/db";
import {
  clearSessionDiagnostic,
  generateSessionDiagnostic,
  writeSessionDiagnostic,
} from "./session-diagnostics";
import {
  PHASE,
  STEP,
  EVENT,
  LIFECYCLE,
  type SessionPhase,
  type SessionStep,
  type SessionContext,
} from "./session-state-machine";
import {
  preparePlanningExecution,
  shouldContinuePlanning,
  writePlanningContextFile,
  type PlanningContextPayload,
} from "./planning-state";

const MAX_PLANNING_CONTINUATIONS = 10;

const PHASE_START_STEP: Record<SessionPhase, SessionStep> = {
  [PHASE.PLANNING]: STEP.READ_ISSUE,
  [PHASE.IMPLEMENTATION]: STEP.EDIT_CODE,
  [PHASE.DELIVERY]: STEP.PREPARE_COMMIT,
  [PHASE.STABILIZATION]: STEP.TRIAGE_REVIEW_FEEDBACK,
  [PHASE.DONE]: STEP.ARCHIVE_RESULT,
};

/** 是否启用 Dashboard 模式（启用时 agent 输出写入日志文件而非 stdout） */
let _dashboardMode = false;
export function setDashboardMode(enabled: boolean): void {
  _dashboardMode = enabled;
}

const logger = consola.withTag("issue-agent");

// ─── syncPromptsToWorktree ─────────────────────────────────

/**
 * 按编辑器映射刷新 worktree 内的 prompts/skills 软链
 * 用于 webhook 触发的二次同步，确保现有 worktree 始终指向最新源目录
 */
export function syncPromptsToWorktree(worktreePath: string): Result<void> {
  const logTagRes = config.getLogTag();
  if (!logTagRes.success) return logTagRes;
  const logTag = logTagRes.data;

  const editor =
    config.EDITORS.find((e) => e.id === logTag) || config.EDITORS[0];

  const syncRes = syncEditorMappings(worktreePath, editor);
  if (!syncRes.success) return syncRes;

  logger.info(`已同步 prompts/skills 到 worktree (${editor.name})`);
  return success(undefined);
}

// ─── execAgent ──────────────────────────────────────────────

type WritableTarget = { write(data: string): any };

function createTimestampedWriter(
  out: WritableTarget,
): WritableTarget & { flush(): void } {
  let buffer = "";

  const writeLine = (line: string) => {
    const stamped = `[${new Date().toISOString()}] ${line}\n`;
    out.write(stamped);
  };

  return {
    write(data: string) {
      buffer += data;
      const parts = buffer.split("\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        writeLine(part);
      }
    },
    flush() {
      if (!buffer) return;
      writeLine(buffer);
      buffer = "";
    },
  };
}

async function drainStream(
  stream: ReadableStream<Uint8Array>,
  out: WritableTarget,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out.write(decoder.decode(value));
  }
}

interface DrainJsonStreamResult {
  sessionId?: string;
}

async function drainJsonStream(
  stream: ReadableStream<Uint8Array>,
  out: WritableTarget,
): Promise<DrainJsonStreamResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sessionId: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const record = JSON.parse(trimmed);
        if (!sessionId && record.sessionId) {
          sessionId = record.sessionId;
        }
        const formatted = formatJsonRecord(record);
        if (formatted) {
          out.write(formatted + "\n");
        }
      } catch {
        out.write(trimmed + "\n");
      }
    }
  }

  if (buffer.trim()) {
    out.write(buffer.trim() + "\n");
  }

  return { sessionId };
}

function formatJsonRecord(record: any): string | null {
  const type = record.type;
  if (type === "assistant") {
    const content = record.message?.content;
    if (Array.isArray(content)) {
      const texts = content
        .filter((c: any) => c.type === "text" && c.text)
        .map((c: any) => c.text);
      if (texts.length > 0) return `[assistant] ${texts.join("\n")}`;
    }
    return null;
  }
  if (type === "tool_use") {
    const msg = record.message;
    if (msg?.content) {
      const tools = Array.isArray(msg.content) ? msg.content : [msg.content];
      return (
        tools
          .filter((c: any) => c.type === "tool_use")
          .map(
            (c: any) =>
              `[tool_use] ${c.name}: ${JSON.stringify(c.input ?? {}).slice(0, 200)}`,
          )
          .join("\n") || null
      );
    }
    return null;
  }
  if (type === "tool_result") {
    const msg = record.message;
    if (msg?.content) {
      const results = Array.isArray(msg.content) ? msg.content : [msg.content];
      return (
        results
          .filter((c: any) => c.type === "tool_result")
          .map((c: any) => {
            const text =
              typeof c.content === "string"
                ? c.content
                : JSON.stringify(c.content);
            return `[tool_result] ${text.slice(0, 200)}`;
          })
          .join("\n") || null
      );
    }
    return null;
  }
  return null;
}

export async function execAgent(
  worktreePath: string,
  issueNumber: number,
  workflow: string,
  onPid?: (pid: number) => void,
  logFile?: string,
  sessionManager?: SessionManager,
): Promise<Result<number>> {
  const isPlanningSymlink = (() => {
    try {
      return fs.lstatSync(worktreePath).isSymbolicLink();
    } catch {
      return false;
    }
  })();

  if (!isPlanningSymlink) {
    const syncRes = syncPromptsToWorktree(worktreePath);
    if (!syncRes.success) return syncRes;
    ensureEditorPermissions(worktreePath);
  }

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
  let fileWriter: (WritableTarget & { flush(): void }) | undefined;

  if (targetLogFile) {
    const ws = fs.createWriteStream(targetLogFile, { flags: "a" });
    fileHandle = ws;
    fileWriter = createTimestampedWriter(ws);
  }

  const out: WritableTarget = fileWriter || process.stdout;
  const err: WritableTarget = fileWriter || process.stderr;
  const isClaude = editor?.id === "claude";

  try {
    let jsonResult: DrainJsonStreamResult | undefined;
    await Promise.all([
      proc.stdout
        ? isClaude
          ? drainJsonStream(proc.stdout, out).then((r) => {
              jsonResult = r;
            })
          : drainStream(proc.stdout, out)
        : Promise.resolve(),
      proc.stderr ? drainStream(proc.stderr, err) : Promise.resolve(),
    ]);

    if (isClaude && jsonResult?.sessionId && sessionManager) {
      sessionManager.updateClaudeSessionId(jsonResult.sessionId);
      logger.info(`已捕获 Claude sessionId: ${jsonResult.sessionId}`);
    }
  } finally {
    fileWriter?.flush();
    fileHandle?.end();
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    logger.warn(`Agent 退出码: ${exitCode}`);
  }
  return success(exitCode);
}

// ─── launchIssueAgent ───────────────────────────────────────

export interface LaunchIssueAgentOptions {
  taskData?: { title: string };
  repoPath?: string;
  _planningContinuationCount?: number;
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
  phase: SessionPhase,
  options: LaunchIssueAgentOptions = {},
): Promise<Result<void>> {
  const paths = new SessionPathManager(owner, repo, issueNumber);
  const session = new SessionManager(owner, repo, issueNumber);

  logger.info(`启动 Issue #${issueNumber} Agent (${phase})...`);
  session.logEvent("issue-agent-launch", { phase, issueNumber });

  let planningContext: PlanningContextPayload | null = null;
  if (phase === PHASE.PLANNING) {
    const planningRes = preparePlanningExecution(owner, repo, issueNumber);
    if (!planningRes.success) {
      return failure(planningRes.error);
    }
    planningContext = planningRes.data;
  }

  const startStep =
    phase === PHASE.PLANNING && planningContext?.openRound
      ? STEP.PROCESS_ROUND
      : PHASE_START_STEP[phase] || STEP.READ_ISSUE;

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

  // 2. 确保工作目录存在
  const worktreePath = paths.getWorktreeDir();
  const isPlanning = phase === PHASE.PLANNING;

  const worktreeExists = fs.existsSync(worktreePath);
  const isPlanningSymlink =
    worktreeExists &&
    (() => {
      try {
        return fs.lstatSync(worktreePath).isSymbolicLink();
      } catch {
        return false;
      }
    })();
  const needsInit = !worktreeExists || (!isPlanning && isPlanningSymlink);

  if (needsInit) {
    if (isPlanning) {
      logger.info("Planning 阶段：创建软链工作目录（指向主仓库）...");
      const repoRoot = options.repoPath || await get_repo_root();
      const wsResult = setupPlanningWorkspace(worktreePath, repoRoot, session);
      if (!wsResult.success) {
        session.markAsError(`planning 工作目录创建失败: ${wsResult.error}`);
        return failure(wsResult.error);
      }
    } else {
      logger.info("工作目录不存在，初始化 worktree...");
      const wtResult = await setupWorktree(worktreePath, options.repoPath, session);
      if (!wtResult.success) {
        session.markAsError(`worktree 创建失败: ${wtResult.error}`);
        return failure(wtResult.error);
      }
    }

    const statusData: Record<string, any> = {
      issueNumber,
      lifecycle: "running",
      phase,
      step: startStep,
      message: `启动 ${phase}`,
      startTime: iso_timestamp(),
      worktreePath,
      title,
      repo: { owner, name: repo },
      context: {
        issueNumber,
        title,
        repo: `${owner}/${repo}`,
      },
    };

    const agentRole = getAgentRole();
    if (agentRole) {
      statusData.agentRole = agentRole;
    }

    try {
      const tagRes = config.getLogTag();
      const tag = tagRes.success ? tagRes.data : "unknown";
      const g = options.repoPath ? getGit(options.repoPath) : git;
      const gitHeadSha = (await g.raw(["rev-parse", "HEAD"])).trim();
      const pkg = JSON.parse(
        fs.readFileSync(path.join(config.ROOT_DIR, "package.json"), "utf-8"),
      );
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

    if (isPlanning) {
      const planRes = initPlanningSession(paths, statusData, session);
      if (!planRes.success) {
        session.markAsError(`planning 会话初始化失败: ${planRes.error}`);
        return failure(planRes.error);
      }
    } else {
      await initSessionFiles(paths, worktreePath, statusData, session);
    }
    logger.success(
      isPlanning ? "planning 工作目录初始化完成" : "worktree 初始化完成",
    );
  } else {
    await session.transition({
      type: "START_PHASE",
      phase,
      step: startStep,
      message: `重新启动 ${phase}`,
    });
  }

  if (!isPlanning) {
    ensureEditorPermissions(worktreePath);
  }

  // 3. 写入 .along-mode 文件
  const modeFile = path.join(paths.getIssueDir(), ".along-mode");
  fs.writeFileSync(modeFile, phase);
  logger.info(`执行模式: ${phase} (已写入 .along-mode)`);
  session.logEvent("along-mode-written", { phase, modeFile });

  if (phase === PHASE.PLANNING && planningContext) {
    const contextWriteRes = writePlanningContextFile(paths, planningContext);
    if (!contextWriteRes.success) {
      return failure(contextWriteRes.error);
    }
    session.logEvent("planning-context-written", {
      file: contextWriteRes.data,
      hasOpenRound: Boolean(planningContext.openRound),
      proposedPlanVersion: planningContext.proposedPlan?.version,
    });
  }

  // 4. 启动 agent
  const workflow =
    phase === "planning"
      ? "resolve-github-issue-planning"
      : "resolve-github-issue-implementation";
  try {
    const tagRes = config.getLogTag();
    if (tagRes.success) {
      const tag = tagRes.data;
      const editor = config.EDITORS.find((e) => e.id === tag);
      const agentCommand = (
        editor?.runTemplate || "{tag} --prompt-template {workflow} {num}"
      )
        .replace("{tag}", tag)
        .replace("{workflow}", workflow)
        .replace("{num}", String(issueNumber));
      await session.transition({
        type: EVENT.STEP_CHANGED,
        phase,
        step: startStep,
        message: `启动 ${phase}`,
        context: {
          agentType: tag,
          agentCommand,
        } as Partial<SessionContext>,
      });
    }
  } catch {}
  await session.transition({
    type: EVENT.START_PHASE,
    phase,
    step: startStep,
    message: `启动 ${phase}`,
  });
  session.logEvent("agent-started", { phase, workflow });
  clearSessionDiagnostic(paths);

  try {
    const logFile = paths.getAgentLogFile();
    const agentRes = await execAgent(
      worktreePath,
      issueNumber,
      workflow,
      (pid) => {
        session.updateStep(startStep, undefined, undefined, undefined, pid);
      },
      logFile,
      session,
    );

    if (!agentRes.success) return agentRes;
    const exitCode = agentRes.data;

    if (exitCode !== 0) {
      let crashLog = "";
      try {
        if (fs.existsSync(logFile)) {
          const content = fs.readFileSync(logFile, "utf-8");
          crashLog =
            content.length > 3000 ? "..." + content.slice(-3000) : content;
        }
      } catch (e) {}
      await session.markAsCrashed(
        `Agent 意外退出 (退出码: ${exitCode})`,
        crashLog || "无法获取日志文件内容",
        exitCode,
      );
      const currentRes = session.readStatus();
      if (currentRes.success && currentRes.data) {
        writeSessionDiagnostic(
          paths,
          generateSessionDiagnostic(currentRes.data, paths),
        );
      }
    } else {
      if (phase === PHASE.PLANNING) {
        const continueRes = shouldContinuePlanning(owner, repo, issueNumber);
        if (!continueRes.success) {
          await session.markAsError(continueRes.error);
          return failure(continueRes.error);
        }
        if (continueRes.data) {
          const count = (options._planningContinuationCount || 0) + 1;
          if (count >= MAX_PLANNING_CONTINUATIONS) {
            await session.markAsError(
              `Planning 连续重启达到上限 (${MAX_PLANNING_CONTINUATIONS})，疑似无限循环`,
            );
            return failure(
              `planning 连续重启超过 ${MAX_PLANNING_CONTINUATIONS} 次上限`,
            );
          }
          session.logEvent("planning-continue", {
            issueNumber,
            continuationCount: count,
          });
          return launchIssueAgent(owner, repo, issueNumber, phase, {
            ...options,
            _planningContinuationCount: count,
          });
        }
      }

      await session.transition({ type: "AGENT_EXITED_SUCCESS" });
    }
    return success(undefined);
  } catch (error: any) {
    await session.markAsCrashed(error.message, error.stack);
    return failure(error.message, error.stack);
  }
}

/**
 * running 标签智能恢复：当 Issue 带有 running 标签但对应的进程已退出时，
 * 自动清理 running 标签，允许用户重新启动任务
 */
export async function tryRecoverFromStaleLabel(
  owner: string,
  repo: string,
  taskNo: number,
): Promise<boolean> {
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

  // 进程已退出，自动清理 running 标签
  logger.warn(
    `Issue #${taskNo} 的 running 标签残留（进程已退出），正在自动清理...`,
  );
  try {
    const clientRes = await get_gh_client();
    if (clientRes.success) {
      await clientRes.data.removeIssueLabel(taskNo, LIFECYCLE.RUNNING);
      logger.success(
        `Issue #${taskNo} 的 ${LIFECYCLE.RUNNING} 标签已自动清理，任务将重新启动`,
      );
      return true;
    }
  } catch (e: any) {
    logger.warn(`自动清理 running 标签失败: ${e.message}`);
  }
  return false;
}
