import type { ThreadEvent, ThreadItem, ThreadOptions } from '@openai/codex-sdk';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  type TaskAgentProgressContext,
  writeTaskAgentProgress,
} from './task-agent-progress';
import {
  isTaskAgentRunCancelled,
  type StartedTaskAgentRun,
  startTaskAgentRun,
  startTaskAgentRunHeartbeat,
} from './task-agent-run-lifecycle';
import { runCodexPrompt } from './task-codex-stream';
import {
  completeCancelledCodexTurn,
  completeCodexTurn,
  failCodexTurn,
} from './task-codex-turn-result';
import {
  buildThreadOptions,
  createCodexClient,
  getCodexOutputSchema,
} from './task-codex-utils';
import {
  TASK_AGENT_PROGRESS_PHASE,
  type TaskAgentRunRecord,
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
  const stopHeartbeat = startTaskAgentRunHeartbeat(
    progressContext,
    usedResume
      ? 'Agent 已启动，正在恢复 Codex thread。'
      : 'Agent 已启动，正在创建 Codex thread。',
    input.cwd,
  );
  try {
    return await executeCodexTurn(
      input,
      prompt,
      progressContext,
      usedResume,
      binding.runtimeSessionId,
    );
  } finally {
    stopHeartbeat();
  }
}

async function executeCodexTurn(
  input: RunTaskCodexTurnInput,
  prompt: string,
  progressContext: TaskAgentProgressContext,
  usedResume: boolean,
  initialThreadId: string | undefined,
): Promise<Result<RunTaskCodexTurnOutput>> {
  const outputSchema = getCodexOutputSchema(input);
  let thread: TaskCodexThread | undefined;
  let latestThreadId = initialThreadId;
  const cancelTurn = (tid?: string) =>
    completeCancelledCodexTurn(
      progressContext,
      usedResume,
      tid ?? latestThreadId,
    );
  try {
    const promptRes = await prepareCodexPrompt(input, prompt, progressContext);
    if (!promptRes.success)
      return failCodexTurn(progressContext, promptRes.error, latestThreadId);
    if (isTaskAgentRunCancelled(progressContext.runId)) return cancelTurn();
    thread = createCodexThread(input, progressContext, initialThreadId);
    return await runAndFinalize(
      input,
      progressContext,
      usedResume,
      thread,
      promptRes.data,
      outputSchema,
      initialThreadId,
      (id) => {
        latestThreadId = id;
      },
    );
  } catch (error: unknown) {
    const tid = thread?.id || latestThreadId;
    return isTaskAgentRunCancelled(progressContext.runId)
      ? cancelTurn(tid)
      : failCodexTurn(progressContext, error, tid);
  }
}

async function runAndFinalize(
  input: RunTaskCodexTurnInput,
  progressContext: TaskAgentProgressContext,
  usedResume: boolean,
  thread: TaskCodexThread,
  promptData: string | LocalImagePromptItem[],
  outputSchema: unknown,
  initialThreadId: string | undefined,
  onThreadId: (id: string) => void,
): Promise<Result<RunTaskCodexTurnOutput>> {
  let latestThreadId = initialThreadId;
  const turn = await runCodexPrompt(
    progressContext.runId,
    progressContext,
    thread,
    promptData,
    outputSchema,
    (id) => {
      latestThreadId = id;
      onThreadId(id);
    },
  );
  latestThreadId = turn.latestThreadId || thread.id || initialThreadId;
  if (isTaskAgentRunCancelled(progressContext.runId))
    return completeCancelledCodexTurn(
      progressContext,
      usedResume,
      latestThreadId,
    );
  return completeCodexTurn(
    input,
    progressContext,
    usedResume,
    turn.turn,
    outputSchema,
    latestThreadId,
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
