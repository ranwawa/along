// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: Codex runner keeps stream orchestration together.
// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: Codex runner keeps stream orchestration together.
import type {
  ThreadEvent,
  ThreadItem,
  ThreadOptions,
  Usage,
} from '@openai/codex-sdk';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  type TaskAgentProgressContext,
  writeTaskAgentProgress,
} from './task-agent-progress';
import {
  completeTaskAgentCancellation,
  finishTaskAgentSuccess,
  isTaskAgentRunCancelled,
  markTaskAgentFailed,
  registerTaskAgentCancellation,
  type StartedTaskAgentRun,
  saveTaskAgentOutput,
  startTaskAgentRun,
  startTaskAgentRunHeartbeat,
} from './task-agent-run-lifecycle';
import { CodexStreamSessionEventMapper } from './task-codex-session-events';
import {
  buildThreadOptions,
  createCodexClient,
  formatDuration,
  getCodexAssistantText,
  getCodexOutputSchema,
  parseStructuredOutput,
  readCodexTurnTimeoutMs,
} from './task-codex-utils';
import {
  TASK_AGENT_PROGRESS_PHASE,
  type TaskAgentRunRecord,
  updateTaskAgentRuntimeSession,
} from './task-planning';
import {
  buildLocalImagePromptInput,
  type LocalImagePromptItem,
  resolveAndRecordInputImages,
} from './task-runner-images';

const RUNTIME_ID = 'codex';

export interface TaskCodexTurn {
  finalResponse: string;
  items: ThreadItem[];
  usage: unknown;
}

export type TaskCodexInputItem =
  | { type: 'text'; text: string }
  | { type: 'local_image'; path: string };

export interface TaskCodexThread {
  readonly id: string | null;
  runStreamed(
    input: string | TaskCodexInputItem[],
    options?: { outputSchema?: unknown; signal?: AbortSignal },
  ): Promise<{ events: AsyncGenerator<ThreadEvent> }>;
}

export interface TaskCodexClient {
  startThread(options?: ThreadOptions): TaskCodexThread;
  resumeThread(id: string, options?: ThreadOptions): TaskCodexThread;
}

export type CreateTaskCodexClient = () => TaskCodexClient;

export interface CodexOutputFormatOptions {
  outputFormat?: {
    type: 'json_schema';
    schema: unknown;
  };
}

interface RunCodexPromptResult {
  turn: TaskCodexTurn;
  latestThreadId?: string;
}

export interface RunTaskCodexTurnInput {
  taskId: string;
  threadId: string;
  agentId: string;
  prompt: string;
  cwd: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  personalityVersion?: string;
  inputArtifactIds?: string[];
  outputMetadata?: Record<string, unknown>;
  options?: CodexOutputFormatOptions;
  createClient?: CreateTaskCodexClient;
  codexOptions?: {
    sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
    approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never';
  };
}

export interface RunTaskCodexTurnOutput {
  run: TaskAgentRunRecord;
  runtimeSessionId?: string;
  usedResume: boolean;
  assistantText: string;
  structuredOutput?: unknown;
  outputArtifactIds: string[];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runTaskCodexTurn(
  input: RunTaskCodexTurnInput,
): Promise<Result<RunTaskCodexTurnOutput>> {
  const prompt = input.prompt.trim();
  if (!prompt) return failure('Codex prompt 不能为空');

  const startedRes = startTaskAgentRun(input, RUNTIME_ID);
  if (!startedRes.success) return startedRes;
  return runStartedCodexTurn(input, prompt, startedRes.data);
}

async function runStartedCodexTurn(
  input: RunTaskCodexTurnInput,
  prompt: string,
  started: StartedTaskAgentRun,
): Promise<Result<RunTaskCodexTurnOutput>> {
  const { binding, progressContext, usedResume } = started;
  const outputSchema = getCodexOutputSchema(input);
  let thread: TaskCodexThread | undefined;
  let latestThreadId = binding.runtimeSessionId;
  const stopHeartbeat = startCodexHeartbeat(started, input.cwd);

  try {
    const promptRes = await prepareCodexPrompt(input, prompt, progressContext);
    if (!promptRes.success)
      return failCodexTurn(progressContext, promptRes.error, latestThreadId);
    if (isTaskAgentRunCancelled(progressContext.runId)) {
      return completeCancelledCodexTurn(
        progressContext,
        usedResume,
        latestThreadId,
      );
    }
    thread = createCodexThread(
      input,
      progressContext,
      binding.runtimeSessionId,
    );
    const turn = await runCodexPrompt(
      progressContext.runId,
      progressContext,
      thread,
      promptRes.data,
      outputSchema,
      (threadId) => {
        latestThreadId = threadId;
      },
    );
    latestThreadId =
      turn.latestThreadId || thread.id || binding.runtimeSessionId;
    if (isTaskAgentRunCancelled(progressContext.runId)) {
      return completeCancelledCodexTurn(
        progressContext,
        usedResume,
        latestThreadId,
      );
    }
    return completeCodexTurn(
      input,
      progressContext,
      usedResume,
      turn.turn,
      outputSchema,
      latestThreadId,
    );
  } catch (error: unknown) {
    if (isTaskAgentRunCancelled(progressContext.runId)) {
      return completeCancelledCodexTurn(
        progressContext,
        usedResume,
        thread?.id || latestThreadId,
      );
    }
    return failCodexTurn(progressContext, error, thread?.id || latestThreadId);
  } finally {
    stopHeartbeat();
  }
}

function startCodexHeartbeat(started: StartedTaskAgentRun, cwd: string) {
  return startTaskAgentRunHeartbeat(
    started.progressContext,
    started.usedResume
      ? 'Agent 已启动，正在恢复 Codex thread。'
      : 'Agent 已启动，正在创建 Codex thread。',
    cwd,
  );
}

async function prepareCodexPrompt(
  input: RunTaskCodexTurnInput,
  prompt: string,
  context: TaskAgentProgressContext,
): Promise<Result<string | LocalImagePromptItem[]>> {
  const imagesRes = await resolveAndRecordInputImages({
    taskId: input.taskId,
    inputArtifactIds: input.inputArtifactIds,
    context,
    summary: '本轮传入 {count} 张用户上传图片。',
  });
  return imagesRes.success
    ? success(buildLocalImagePromptInput(prompt, imagesRes.data))
    : failure(imagesRes.error);
}

function failCodexTurn(
  context: TaskAgentProgressContext,
  error: unknown,
  runtimeSessionIdAtEnd?: string,
): Result<never> {
  const message = getErrorMessage(error);
  if (runtimeSessionIdAtEnd) {
    updateTaskAgentRuntimeSession(
      context.threadId,
      context.agentId,
      RUNTIME_ID,
      runtimeSessionIdAtEnd,
    );
  }
  const failedRes = markTaskAgentFailed(
    context,
    message,
    runtimeSessionIdAtEnd,
  );
  return failedRes.success
    ? failure(`Codex Agent 执行失败: ${message}`)
    : failure(failedRes.error);
}

function createCodexThread(
  input: RunTaskCodexTurnInput,
  context: TaskAgentProgressContext,
  runtimeSessionId?: string,
): TaskCodexThread {
  const client = input.createClient
    ? input.createClient()
    : createCodexClient(input);
  writeTaskAgentProgress(
    context,
    TASK_AGENT_PROGRESS_PHASE.CONTEXT,
    '正在准备工作目录和模型参数。',
  );
  const options = buildThreadOptions(input);
  const thread = runtimeSessionId
    ? client.resumeThread(runtimeSessionId, options)
    : client.startThread(options);
  writeTaskAgentProgress(
    context,
    TASK_AGENT_PROGRESS_PHASE.WAITING,
    'Agent 正在执行任务，等待 Codex 返回结果。',
  );
  return thread;
}

async function runCodexPrompt(
  runId: string,
  context: TaskAgentProgressContext,
  thread: TaskCodexThread,
  prompt: string | TaskCodexInputItem[],
  outputSchema: unknown,
  onThreadStarted: (threadId: string) => void,
): Promise<RunCodexPromptResult> {
  const timeoutMs = readCodexTurnTimeoutMs();
  const abortController = new AbortController();
  const unregisterCancel = registerTaskAgentCancellation(runId, (reason) =>
    abortController.abort(reason),
  );
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);
  return runCodexThreadWithTimeout(
    thread,
    context,
    prompt,
    outputSchema,
    abortController,
    timeout,
    () => timedOut,
    timeoutMs,
    unregisterCancel,
    onThreadStarted,
  );
}

async function runCodexThreadWithTimeout(
  thread: TaskCodexThread,
  context: TaskAgentProgressContext,
  prompt: string | TaskCodexInputItem[],
  outputSchema: unknown,
  abortController: AbortController,
  timeout: ReturnType<typeof setTimeout>,
  isTimedOut: () => boolean,
  timeoutMs: number,
  unregisterCancel: () => void,
  onThreadStarted: (threadId: string) => void,
): Promise<RunCodexPromptResult> {
  try {
    const stream = await thread.runStreamed(prompt, {
      outputSchema,
      signal: abortController.signal,
    });
    return await consumeCodexStream(context, stream.events, onThreadStarted);
  } catch (error: unknown) {
    if (!isTimedOut()) throw error;
    throw new Error(
      `Codex Agent 执行超时（超过 ${formatDuration(timeoutMs)}）`,
      {
        cause: error,
      },
    );
  } finally {
    unregisterCancel();
    clearTimeout(timeout);
  }
}

async function consumeCodexStream(
  context: TaskAgentProgressContext,
  events: AsyncGenerator<ThreadEvent>,
  onThreadStarted: (threadId: string) => void,
): Promise<RunCodexPromptResult> {
  const mapper = new CodexStreamSessionEventMapper(context);
  const items: ThreadItem[] = [];
  let finalResponse = '';
  let usage: Usage | null = null;
  let latestThreadId: string | undefined;

  for await (const event of events) {
    const eventRes = mapper.handleEvent(event);
    if (!eventRes.success) throw new Error(eventRes.error);
    if (eventRes.data.latestThreadId) {
      latestThreadId = eventRes.data.latestThreadId;
      onThreadStarted(latestThreadId);
    }
    if (event.type === 'item.completed') {
      items.push(event.item);
      if (event.item.type === 'agent_message') {
        finalResponse = event.item.text;
      }
    } else if (event.type === 'turn.completed') {
      usage = event.usage;
    } else if (event.type === 'turn.failed') {
      throw new Error(event.error.message);
    } else if (event.type === 'error') {
      throw new Error(event.message);
    }
  }

  return {
    turn: {
      finalResponse,
      items,
      usage,
    },
    latestThreadId,
  };
}

function completeCancelledCodexTurn(
  context: TaskAgentProgressContext,
  usedResume: boolean,
  latestThreadId?: string,
): Result<RunTaskCodexTurnOutput> {
  const runRes = completeTaskAgentCancellation(
    context,
    'Codex Agent 运行已中断，跳过保存输出。',
  );
  if (!runRes.success) return runRes;
  return success({
    run: runRes.data,
    runtimeSessionId: latestThreadId,
    usedResume,
    assistantText: '',
    outputArtifactIds: [],
  });
}

function completeCodexTurn(
  input: RunTaskCodexTurnInput,
  context: TaskAgentProgressContext,
  usedResume: boolean,
  turn: TaskCodexTurn,
  outputSchema: unknown,
  latestThreadId?: string,
): Result<RunTaskCodexTurnOutput> {
  const sessionRes = saveCodexSession(input, context, latestThreadId);
  if (!sessionRes.success) return sessionRes;
  const assistantText = getCodexAssistantText(turn);
  const structuredOutput = parseStructuredOutput(assistantText, outputSchema);
  const outputRes = saveTaskAgentOutput(
    input,
    RUNTIME_ID,
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
    runtimeSessionId: latestThreadId,
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
  const updateRes = updateTaskAgentRuntimeSession(
    input.threadId,
    input.agentId,
    RUNTIME_ID,
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
