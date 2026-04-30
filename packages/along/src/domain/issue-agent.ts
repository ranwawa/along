/**
 * issue-agent.ts - Issue Agent 共享启动模块
 *
 * 提供 launchIssueAgent() 作为核心入口，供 webhook-server 和 CLI (run.ts) 共同调用。
 * 将 worktree 初始化、session 管理、.along-mode 写入、agent 执行等逻辑统一封装。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  type Options as ClaudeSDKOptions,
  query,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { consola } from 'consola';
import type { Result } from '../core/common';
import {
  check_process_running,
  ensureEditorPermissions,
  failure,
  get_repo_root,
  getGit,
  git,
  iso_timestamp,
  success,
} from '../core/common';
import { config } from '../core/config';
import { readSession } from '../core/db';
import { SessionPathManager } from '../core/session-paths';
import { getAgentRole } from '../integration/agent-config';
import { get_gh_client } from '../integration/github-client';
import {
  type PlanningContextPayload,
  preparePlanningExecution,
  shouldContinuePlanning,
  writePlanningContextFile,
} from './planning-state';
import {
  clearSessionDiagnostic,
  generateSessionDiagnostic,
  writeSessionDiagnostic,
} from './session-diagnostics';
import { SessionManager } from './session-manager';
import {
  EVENT,
  LIFECYCLE,
  PHASE,
  type SessionContext,
  type SessionPhase,
  type SessionStep,
  STEP,
} from './session-state-machine';
import {
  initPlanningSession,
  initSessionFiles,
  setupPlanningWorkspace,
  setupWorktree,
  syncEditorMappings,
} from './worktree-init';

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

const logger = consola.withTag('issue-agent');

// ─── syncPromptsToWorktree ─────────────────────────────────

/**
 * 刷新编辑器运行时映射。
 * 项目通用 prompts / skills 已由 preset 同步进仓库，这里只保留 along 自身的运行时注入点。
 */
export function syncPromptsToWorktree(worktreePath: string): Result<void> {
  const logTagRes = config.getLogTag();
  if (!logTagRes.success) return logTagRes;
  const logTag = logTagRes.data;

  const editor =
    config.EDITORS.find((e) => e.id === logTag) || config.EDITORS[0];

  const syncRes = syncEditorMappings(worktreePath, editor);
  if (!syncRes.success) return syncRes;

  logger.info(`已检查编辑器运行时映射 (${editor.name})`);
  return success(undefined);
}

// ─── Agent 执行结果抽象 ─────────────────────────────────────

export interface AgentExecutionSummary {
  exitCode: number;
  nativeError?: { message: string; details?: string };
}

// ─── execAgent ──────────────────────────────────────────────

type WritableTarget = { write(data: string): any };

function createTimestampedWriter(
  out: WritableTarget,
): WritableTarget & { flush(): void } {
  let buffer = '';

  const writeLine = (line: string) => {
    const stamped = `[${new Date().toISOString()}] ${line}\n`;
    out.write(stamped);
  };

  return {
    write(data: string) {
      buffer += data;
      const parts = buffer.split('\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        writeLine(part);
      }
    },
    flush() {
      if (!buffer) return;
      writeLine(buffer);
      buffer = '';
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

const PERSISTED_MESSAGE_TYPES = new Set([
  'assistant',
  'user',
  'result',
  'tool_use_summary',
  'rate_limit_event',
]);

const PERSISTED_SYSTEM_SUBTYPES = new Set(['compact_boundary', 'api_retry']);

function shouldPersistMessage(msg: SDKMessage): boolean {
  if (PERSISTED_MESSAGE_TYPES.has(msg.type)) return true;
  if (msg.type === 'system') {
    return PERSISTED_SYSTEM_SUBTYPES.has((msg as any).subtype);
  }
  return false;
}

function formatSDKMessage(message: SDKMessage): string | null {
  if (message.type === 'assistant') {
    const content = message.message?.content;
    if (Array.isArray(content)) {
      const texts = content
        .filter((c: any) => c.type === 'text' && c.text)
        .map((c: any) => c.text);
      if (texts.length > 0) return `[assistant] ${texts.join('\n')}`;
    }
    return null;
  }
  if (message.type === 'result') {
    const msgAny = message as any;
    if (msgAny.is_error === true) {
      const errors = Array.isArray(msgAny.errors)
        ? msgAny.errors
        : ['未知错误'];
      return `[result] 错误: ${errors.join(', ')} (${message.num_turns} turns)`;
    }
    if (message.subtype === 'success') {
      return `[result] 完成 (${message.num_turns} turns, $${message.total_cost_usd.toFixed(4)})`;
    }
    return `[result] ${message.subtype} (${message.num_turns} turns)`;
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
  conversationFile?: string,
): Promise<Result<AgentExecutionSummary>> {
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

  if (editor?.id === 'claude') {
    return execClaudeAgent(
      worktreePath,
      issueNumber,
      workflow,
      sessionManager,
      logFile,
      conversationFile,
    );
  }

  return execSpawnAgent(
    worktreePath,
    issueNumber,
    workflow,
    logTag,
    editor,
    onPid,
    logFile,
    sessionManager,
  );
}

async function execClaudeAgent(
  worktreePath: string,
  issueNumber: number,
  workflow: string,
  sessionManager?: SessionManager,
  logFile?: string,
  conversationFile?: string,
): Promise<Result<AgentExecutionSummary>> {
  const promptPath = path.join(worktreePath, `.claude/commands/${workflow}.md`);
  if (!fs.existsSync(promptPath)) {
    return failure(`workflow prompt 文件不存在: ${promptPath}`);
  }
  const appendPrompt = fs.readFileSync(promptPath, 'utf-8');

  const options: ClaudeSDKOptions = {
    cwd: worktreePath,
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: appendPrompt,
    },
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    allowedTools: [
      `Bash(along *)`,
      `Read(${config.USER_ALONG_DIR}/**)`,
      `Edit(${config.USER_ALONG_DIR}/**)`,
      `Write(${config.USER_ALONG_DIR}/**)`,
    ],
    debug: true,
    maxTurns: 200,
  };

  const prompt = `请解决 GitHub Issue #${issueNumber}，严格按照系统提示中的工作流执行`;

  logger.info(`启动 Claude Agent (SDK), workflow: ${workflow}`);

  const targetLogFile = _dashboardMode ? logFile : undefined;
  let fileHandle: { write(data: string): any; end(): void } | undefined;
  let fileWriter: (WritableTarget & { flush(): void }) | undefined;

  if (targetLogFile) {
    const ws = fs.createWriteStream(targetLogFile, { flags: 'a' });
    fileHandle = ws;
    fileWriter = createTimestampedWriter(ws);
  }

  const out: WritableTarget = fileWriter || process.stdout;
  let sessionId: string | undefined;

  let convHandle: fs.WriteStream | undefined;
  if (conversationFile) {
    fs.mkdirSync(path.dirname(conversationFile), { recursive: true });
    convHandle = fs.createWriteStream(conversationFile, { flags: 'a' });
  }

  try {
    const conversation = query({ prompt, options });
    let receivedResult = false;

    for await (const message of conversation) {
      if (!sessionId && 'session_id' in message) {
        sessionId = message.session_id as string;
      }

      if (convHandle && shouldPersistMessage(message)) {
        convHandle.write(`${JSON.stringify(message)}\n`);
      }

      const formatted = formatSDKMessage(message);
      if (formatted) out.write(`${formatted}\n`);

      if (message.type === 'result') {
        receivedResult = true;

        if (sessionId && sessionManager) {
          sessionManager.updateClaudeSessionId(sessionId);
          logger.info(`已捕获 Claude sessionId: ${sessionId}`);
        }

        const msgAny = message as any;
        const isError = msgAny.is_error === true;
        const hasErrors =
          Array.isArray(msgAny.errors) && msgAny.errors.length > 0;

        if (isError || hasErrors) {
          const errorMessage = hasErrors
            ? msgAny.errors.join(', ')
            : 'Agent 执行出错';
          logger.error(`Claude Agent SDK 报告错误: ${errorMessage}`);
          return success({
            exitCode: 1,
            nativeError: {
              message: errorMessage,
              details: JSON.stringify(message),
            },
          });
        }

        if (message.subtype !== 'success') {
          logger.warn(`Claude Agent 异常结束: ${message.subtype}`);
          return success({ exitCode: 1 });
        }

        return success({ exitCode: 0 });
      }
    }

    if (!receivedResult) {
      const errorMessage = 'Agent 执行流结束但未收到结果';
      logger.error(errorMessage);
      return success({
        exitCode: 1,
        nativeError: { message: errorMessage },
      });
    }
  } catch (error: any) {
    logger.error(`Claude Agent SDK 执行异常: ${error.message}`);
    return success({
      exitCode: 1,
      nativeError: { message: error.message, details: error.stack },
    });
  } finally {
    fileWriter?.flush();
    fileHandle?.end();
    convHandle?.end();
  }
}

async function execSpawnAgent(
  worktreePath: string,
  issueNumber: number,
  workflow: string,
  logTag: string,
  editor: (typeof config.EDITORS)[number] | undefined,
  onPid?: (pid: number) => void,
  logFile?: string,
  _sessionManager?: SessionManager,
): Promise<Result<AgentExecutionSummary>> {
  let cmd = editor?.runTemplate || '{tag} --prompt-template {workflow} {num}';
  cmd = cmd
    .replace('{tag}', logTag)
    .replace('{workflow}', workflow)
    .replace('{num}', String(issueNumber));

  logger.info(`启动 Agent (${editor?.name || logTag}), workflow: ${workflow}`);
  logger.info(`执行命令: ${cmd}`);

  const proc = Bun.spawn(['bash', '-c', cmd], {
    cwd: worktreePath,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (onPid && proc.pid) {
    onPid(proc.pid);
  }

  const targetLogFile = _dashboardMode ? logFile : undefined;
  let fileHandle: { write(data: string): any; end(): void } | undefined;
  let fileWriter: (WritableTarget & { flush(): void }) | undefined;

  if (targetLogFile) {
    const ws = fs.createWriteStream(targetLogFile, { flags: 'a' });
    fileHandle = ws;
    fileWriter = createTimestampedWriter(ws);
  }

  const out: WritableTarget = fileWriter || process.stdout;
  const err: WritableTarget = fileWriter || process.stderr;

  try {
    await Promise.all([
      proc.stdout ? drainStream(proc.stdout, out) : Promise.resolve(),
      proc.stderr ? drainStream(proc.stderr, err) : Promise.resolve(),
    ]);
  } finally {
    fileWriter?.flush();
    fileHandle?.end();
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    logger.warn(`Agent 退出码: ${exitCode}`);
  }
  return success({ exitCode });
}

// ─── launchIssueAgent ───────────────────────────────────────

export interface LaunchIssueAgentOptions {
  taskData?: { title: string };
  repoPath?: string;
  trigger?: string;
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
  const trigger = options.trigger || 'unknown';
  const invocationId = crypto.randomUUID().slice(0, 8);

  logger.info(
    `启动 Issue #${issueNumber} Agent (${phase}) [trigger=${trigger}, invocation=${invocationId}]`,
  );
  session.logEvent('issue-agent-launch', {
    phase,
    issueNumber,
    trigger,
    invocationId,
  });

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
  let title = options.taskData?.title || '';
  if (!title) {
    const issueFile = paths.getIssueFile();
    if (fs.existsSync(issueFile)) {
      try {
        const issueData = JSON.parse(fs.readFileSync(issueFile, 'utf-8'));
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
      logger.info('Planning 阶段：创建软链工作目录（指向主仓库）...');
      const repoRoot = options.repoPath || (await get_repo_root());
      const wsResult = setupPlanningWorkspace(worktreePath, repoRoot, session);
      if (!wsResult.success) {
        session.markAsError(`planning 工作目录创建失败: ${wsResult.error}`);
        return failure(wsResult.error);
      }
    } else {
      logger.info('工作目录不存在，初始化 worktree...');
      const wtResult = await setupWorktree(
        worktreePath,
        options.repoPath,
        session,
      );
      if (!wtResult.success) {
        session.markAsError(`worktree 创建失败: ${wtResult.error}`);
        return failure(wtResult.error);
      }
    }

    const statusData: Record<string, any> = {
      issueNumber,
      lifecycle: 'running',
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
      const tag = tagRes.success ? tagRes.data : 'unknown';
      const g = options.repoPath ? getGit(options.repoPath) : git;
      const gitHeadSha = (await g.raw(['rev-parse', 'HEAD'])).trim();
      const pkg = JSON.parse(
        fs.readFileSync(path.join(config.ROOT_DIR, 'package.json'), 'utf-8'),
      );
      statusData.agentType = tag;
      statusData.environment = {
        agentType: tag,
        gitHeadSha,
        alongVersion: pkg.version || 'unknown',
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
      isPlanning ? 'planning 工作目录初始化完成' : 'worktree 初始化完成',
    );
  } else {
    await session.transition({
      type: 'START_PHASE',
      phase,
      step: startStep,
      message: `重新启动 ${phase}`,
    });
  }

  if (!isPlanning) {
    ensureEditorPermissions(worktreePath);
  }

  // 3. 写入 .along-mode 文件
  const modeFile = path.join(paths.getIssueDir(), '.along-mode');
  fs.writeFileSync(modeFile, phase);
  logger.info(`执行模式: ${phase} (已写入 .along-mode)`);
  session.logEvent('along-mode-written', { phase, modeFile });

  if (phase === PHASE.PLANNING && planningContext) {
    const contextWriteRes = writePlanningContextFile(paths, planningContext);
    if (!contextWriteRes.success) {
      return failure(contextWriteRes.error);
    }
    session.logEvent('planning-context-written', {
      file: contextWriteRes.data,
      hasOpenRound: Boolean(planningContext.openRound),
      proposedPlanVersion: planningContext.proposedPlan?.version,
      planId: planningContext.proposedPlan?.planId,
      invocationId,
    });
  }

  // 4. 启动 agent
  const workflow =
    phase === 'planning'
      ? 'resolve-github-issue-planning'
      : 'resolve-github-issue-implementation';
  try {
    const tagRes = config.getLogTag();
    if (tagRes.success) {
      const tag = tagRes.data;
      const editor = config.EDITORS.find((e) => e.id === tag);
      const agentCommand = (
        editor?.runTemplate || '{tag} --prompt-template {workflow} {num}'
      )
        .replace('{tag}', tag)
        .replace('{workflow}', workflow)
        .replace('{num}', String(issueNumber));
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
  session.logEvent('agent-started', { phase, workflow });
  clearSessionDiagnostic(paths);

  try {
    const logFile = paths.getAgentLogFile();
    const convFile = paths.getConversationFile(phase, workflow);
    const agentRes = await execAgent(
      worktreePath,
      issueNumber,
      workflow,
      (pid) => {
        session.updateStep(startStep, undefined, undefined, undefined, pid);
      },
      logFile,
      session,
      convFile,
    );

    if (!agentRes.success) return agentRes;
    const summary = agentRes.data;
    const exitCode = summary.exitCode;

    if (exitCode !== 0) {
      let crashLog = '';
      try {
        if (fs.existsSync(logFile)) {
          const content = fs.readFileSync(logFile, 'utf-8');
          crashLog =
            content.length > 3000 ? `...${content.slice(-3000)}` : content;
        }
      } catch (_e) {}
      const nativeErrorMsg = summary.nativeError
        ? ` [SDK 错误: ${summary.nativeError.message}]`
        : '';
      await session.markAsCrashed(
        `Agent 意外退出 (退出码: ${exitCode})${nativeErrorMsg}`,
        crashLog || '无法获取日志文件内容',
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
          session.logEvent('planning-continue', {
            issueNumber,
            continuationCount: count,
          });
          return launchIssueAgent(owner, repo, issueNumber, phase, {
            ...options,
            trigger: 'planning-continuation',
            _planningContinuationCount: count,
          });
        }
      }

      await session.transition({ type: 'AGENT_EXITED_SUCCESS' });
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
