import type { ThreadOptions } from '@openai/codex-sdk';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  type TaskAgentProgressContext,
  writeTaskAgentProgress,
  writeTaskAgentSessionEvent,
} from './task-agent-progress';
import {
  finishTaskAgentSuccess,
  markTaskAgentFailed,
  type StartedTaskAgentRun,
  saveTaskAgentOutput,
  startTaskAgentRun,
  startTaskAgentRunHeartbeat,
} from './task-agent-run-lifecycle';
import type {
  RunTaskClaudeTurnInput,
  RunTaskClaudeTurnOutput,
} from './task-claude-runner';
import {
  buildThreadOptions,
  createDefaultCodexClient,
  formatDuration,
  getCodexAssistantText,
  getCodexOutputSchema,
  parseStructuredOutput,
  readCodexTurnTimeoutMs,
} from './task-codex-utils';
import {
  TASK_AGENT_PROGRESS_PHASE,
  updateTaskAgentProviderSession,
} from './task-planning';

const PROVIDER = 'codex';

export interface TaskCodexTurn {
  finalResponse: string;
  items: unknown[];
  usage: unknown;
}

export interface TaskCodexThread {
  readonly id: string | null;
  run(
    input: string,
    options?: { outputSchema?: unknown; signal?: AbortSignal },
  ): Promise<TaskCodexTurn>;
}

export interface TaskCodexClient {
  startThread(options?: ThreadOptions): TaskCodexThread;
  resumeThread(id: string, options?: ThreadOptions): TaskCodexThread;
}

export type CreateTaskCodexClient = () => TaskCodexClient;

export interface RunTaskCodexTurnInput extends RunTaskClaudeTurnInput {
  createClient?: CreateTaskCodexClient;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runTaskCodexTurn(
  input: RunTaskCodexTurnInput,
): Promise<Result<RunTaskClaudeTurnOutput>> {
  const prompt = input.prompt.trim();
  if (!prompt) return failure('Codex prompt 不能为空');

  const startedRes = startTaskAgentRun(input, PROVIDER);
  if (!startedRes.success) return startedRes;
  return runStartedCodexTurn(input, prompt, startedRes.data);
}

async function runStartedCodexTurn(
  input: RunTaskCodexTurnInput,
  prompt: string,
  started: StartedTaskAgentRun,
): Promise<Result<RunTaskClaudeTurnOutput>> {
  const { binding, progressContext, usedResume } = started;
  const outputSchema = getCodexOutputSchema(input);
  let thread: TaskCodexThread | undefined;
  let latestThreadId = binding.providerSessionId;
  const stopHeartbeat = startTaskAgentRunHeartbeat(
    progressContext,
    usedResume
      ? 'Agent 已启动，正在恢复 Codex thread。'
      : 'Agent 已启动，正在创建 Codex thread。',
    input.cwd,
  );

  try {
    thread = openCodexThread(input, progressContext, binding.providerSessionId);
    const turn = await runCodexPrompt(thread, prompt, outputSchema);
    latestThreadId = thread.id || binding.providerSessionId;
    writeCodexTurnSessionEvents(progressContext, turn);
    return completeCodexTurn(
      input,
      progressContext,
      usedResume,
      turn,
      outputSchema,
      latestThreadId,
    );
  } catch (error: unknown) {
    return failCodexTurn(progressContext, error, thread?.id || latestThreadId);
  } finally {
    stopHeartbeat();
  }
}

function writeCodexTurnSessionEvents(
  context: TaskAgentProgressContext,
  turn: TaskCodexTurn,
) {
  if (turn.finalResponse.trim()) {
    writeTaskAgentSessionEvent(context, 'agent', 'output', turn.finalResponse, {
      type: 'final_response',
    });
  }
  if (turn.items.length > 0) {
    writeTaskAgentSessionEvent(
      context,
      'tool',
      'message',
      `Codex 返回 ${turn.items.length} 条会话 item。`,
      { type: 'items', count: turn.items.length },
    );
  }
}

function failCodexTurn(
  context: TaskAgentProgressContext,
  error: unknown,
  providerSessionIdAtEnd?: string,
): Result<never> {
  const message = getErrorMessage(error);
  if (providerSessionIdAtEnd) {
    updateTaskAgentProviderSession(
      context.threadId,
      context.agentId,
      PROVIDER,
      providerSessionIdAtEnd,
    );
  }
  const failedRes = markTaskAgentFailed(
    context,
    message,
    providerSessionIdAtEnd,
  );
  return failedRes.success
    ? failure(`Codex Agent 执行失败: ${message}`)
    : failure(failedRes.error);
}

function openCodexThread(
  input: RunTaskCodexTurnInput,
  context: TaskAgentProgressContext,
  providerSessionId?: string,
): TaskCodexThread {
  const client = (input.createClient || createDefaultCodexClient)();
  writeTaskAgentProgress(
    context,
    TASK_AGENT_PROGRESS_PHASE.CONTEXT,
    '正在准备工作目录和模型参数。',
  );
  const options = buildThreadOptions(input);
  const thread = providerSessionId
    ? client.resumeThread(providerSessionId, options)
    : client.startThread(options);
  writeTaskAgentProgress(
    context,
    TASK_AGENT_PROGRESS_PHASE.WAITING,
    'Agent 正在执行任务，等待 Codex 返回结果。',
  );
  return thread;
}

async function runCodexPrompt(
  thread: TaskCodexThread,
  prompt: string,
  outputSchema: unknown,
): Promise<TaskCodexTurn> {
  const timeoutMs = readCodexTurnTimeoutMs();
  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);
  return runCodexThreadWithTimeout(
    thread,
    prompt,
    outputSchema,
    abortController,
    timeout,
    () => timedOut,
    timeoutMs,
  );
}

async function runCodexThreadWithTimeout(
  thread: TaskCodexThread,
  prompt: string,
  outputSchema: unknown,
  abortController: AbortController,
  timeout: ReturnType<typeof setTimeout>,
  isTimedOut: () => boolean,
  timeoutMs: number,
): Promise<TaskCodexTurn> {
  try {
    return await thread.run(prompt, {
      outputSchema,
      signal: abortController.signal,
    });
  } catch (error: unknown) {
    if (!isTimedOut()) throw error;
    throw new Error(
      `Codex Agent 执行超时（超过 ${formatDuration(timeoutMs)}）`,
      {
        cause: error,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function completeCodexTurn(
  input: RunTaskCodexTurnInput,
  context: TaskAgentProgressContext,
  usedResume: boolean,
  turn: TaskCodexTurn,
  outputSchema: unknown,
  latestThreadId?: string,
): Result<RunTaskClaudeTurnOutput> {
  const sessionRes = saveCodexSession(input, context, latestThreadId);
  if (!sessionRes.success) return sessionRes;
  const assistantText = getCodexAssistantText(turn);
  const structuredOutput = parseStructuredOutput(assistantText, outputSchema);
  const outputRes = saveTaskAgentOutput(
    input,
    PROVIDER,
    assistantText,
    context,
    latestThreadId,
  );
  if (!outputRes.success) return outputRes;
  const finishedRun = finishTaskAgentSuccess(
    context,
    outputRes.data,
    latestThreadId,
  );
  if (!finishedRun.success) return finishedRun;
  return success({
    run: finishedRun.data,
    providerSessionId: latestThreadId,
    usedResume,
    assistantText,
    structuredOutput,
    outputArtifactIds: outputRes.data,
  });
}

function saveCodexSession(
  input: RunTaskCodexTurnInput,
  context: TaskAgentProgressContext,
  latestThreadId?: string,
): Result<void> {
  if (!latestThreadId) return success(undefined);
  writeTaskAgentProgress(
    context,
    TASK_AGENT_PROGRESS_PHASE.CONTEXT,
    '正在保存 Agent 会话标识。',
  );
  const updateRes = updateTaskAgentProviderSession(
    input.threadId,
    input.agentId,
    PROVIDER,
    latestThreadId,
  );
  if (updateRes.success) return success(undefined);
  const failedRes = markTaskAgentFailed(
    context,
    updateRes.error,
    latestThreadId,
    '保存 Agent 会话标识失败。',
  );
  return failedRes.success ? failure(updateRes.error) : failedRes;
}
