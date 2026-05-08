// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: legacy runner keeps provider orchestration together.
// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: legacy runner keeps provider orchestration together.
import {
  type Options as ClaudeSDKOptions,
  query,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  type TaskAgentProgressContext,
  writeTaskAgentProgress,
  writeTaskAgentSessionEvent,
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
import {
  buildClaudePrompt,
  type ClaudePrompt,
} from './task-claude-image-prompt';
import {
  getAssistantMessageText,
  getResultError,
  getResultStructuredOutput,
  getResultText,
  getSessionId,
  summarizeClaudeProgress,
  summarizeClaudeSessionEvent,
} from './task-claude-messages';
import {
  type TaskAgentRunRecord,
  updateTaskAgentProviderSession,
} from './task-planning';
import { resolveAndRecordInputImages } from './task-runner-images';

const PROVIDER = 'claude';
const DEFAULT_MAX_TURNS = 50;

export interface RunTaskClaudeTurnInput {
  taskId: string;
  threadId: string;
  agentId: string;
  prompt: string;
  cwd: string;
  model?: string;
  personalityVersion?: string;
  inputArtifactIds?: string[];
  outputMetadata?: Record<string, unknown>;
  options?: Partial<ClaudeSDKOptions>;
}

export interface RunTaskClaudeTurnOutput {
  run: TaskAgentRunRecord;
  providerSessionId?: string;
  usedResume: boolean;
  assistantText: string;
  structuredOutput?: unknown;
  outputArtifactIds: string[];
}

interface ClaudeTurnState {
  latestSessionId?: string;
  assistantTextParts: string[];
  finalResultText?: string;
  structuredOutput?: unknown;
}

type AbortableClaudeOptions = ClaudeSDKOptions & {
  abortController?: AbortController;
  signal?: AbortSignal;
};

function buildOptions(
  input: RunTaskClaudeTurnInput,
  resumeSessionId?: string,
  abortController?: AbortController,
): AbortableClaudeOptions {
  return {
    ...input.options,
    cwd: input.cwd,
    model: input.model,
    resume: resumeSessionId,
    permissionMode: input.options?.permissionMode || 'plan',
    maxTurns: input.options?.maxTurns || DEFAULT_MAX_TURNS,
    abortController,
    signal: abortController?.signal,
  };
}

export async function runTaskClaudeTurn(
  input: RunTaskClaudeTurnInput,
): Promise<Result<RunTaskClaudeTurnOutput>> {
  const prompt = input.prompt.trim();
  if (!prompt) return failure('Claude prompt 不能为空');

  const startedRes = startTaskAgentRun(input, PROVIDER);
  if (!startedRes.success) return startedRes;
  return runStartedClaudeTurn(input, prompt, startedRes.data);
}

async function runStartedClaudeTurn(
  input: RunTaskClaudeTurnInput,
  prompt: string,
  started: StartedTaskAgentRun,
): Promise<Result<RunTaskClaudeTurnOutput>> {
  const stopHeartbeat = startClaudeHeartbeat(started, input.cwd);
  const abortController = new AbortController();
  const unregisterCancel = registerTaskAgentCancellation(
    started.run.runId,
    (reason) => abortController.abort(reason),
  );

  try {
    const promptRes = await prepareClaudePrompt(input, prompt, started);
    if (!promptRes.success) {
      return failClaudeTurn(
        started.progressContext,
        promptRes.error,
        started.binding.providerSessionId,
      );
    }
    if (isTaskAgentRunCancelled(started.run.runId)) {
      return completeCancelledClaudeTurn(started);
    }
    const conversation = query({
      prompt: promptRes.data,
      options: buildOptions(
        input,
        started.binding.providerSessionId,
        abortController,
      ),
    });
    const stateRes = await collectClaudeConversation(
      conversation,
      started.progressContext,
      started.binding.providerSessionId,
    );
    if (isTaskAgentRunCancelled(started.run.runId)) {
      return completeCancelledClaudeTurn(
        started,
        stateRes.success ? stateRes.data : undefined,
      );
    }
    if (!stateRes.success) return stateRes;
    return completeClaudeTurn(input, started, stateRes.data);
  } catch (error: unknown) {
    if (isTaskAgentRunCancelled(started.run.runId)) {
      return completeCancelledClaudeTurn(started);
    }
    return failClaudeTurn(
      started.progressContext,
      error,
      started.binding.providerSessionId,
    );
  } finally {
    unregisterCancel();
    stopHeartbeat();
  }
}

function startClaudeHeartbeat(started: StartedTaskAgentRun, cwd: string) {
  return startTaskAgentRunHeartbeat(
    started.progressContext,
    started.usedResume
      ? 'Agent 已启动，正在恢复上次会话。'
      : 'Agent 已启动，正在准备任务上下文。',
    cwd,
  );
}

async function prepareClaudePrompt(
  input: RunTaskClaudeTurnInput,
  prompt: string,
  started: StartedTaskAgentRun,
): Promise<Result<ClaudePrompt>> {
  const imagesRes = await resolveAndRecordInputImages({
    taskId: input.taskId,
    inputArtifactIds: input.inputArtifactIds,
    context: started.progressContext,
    summary: '本轮传入 {count} 张用户上传图片。',
  });
  return imagesRes.success
    ? success(buildClaudePrompt(prompt, imagesRes.data))
    : failure(imagesRes.error);
}

async function collectClaudeConversation(
  conversation: AsyncIterable<SDKMessage>,
  context: TaskAgentProgressContext,
  latestSessionId?: string,
): Promise<Result<ClaudeTurnState>> {
  const state: ClaudeTurnState = {
    latestSessionId,
    assistantTextParts: [],
  };
  for await (const message of conversation) {
    const messageRes = processClaudeMessage(state, context, message);
    if (!messageRes.success) return messageRes;
  }
  return success(state);
}

function processClaudeMessage(
  state: ClaudeTurnState,
  context: TaskAgentProgressContext,
  message: SDKMessage,
): Result<void> {
  const sessionId = getSessionId(message);
  if (sessionId) state.latestSessionId = sessionId;
  writeClaudeSessionEvent(context, message);
  writeClaudeProgress(context, message);
  state.assistantTextParts.push(...getAssistantMessageText(message));
  const resultText = getResultText(message);
  if (resultText) state.finalResultText = resultText;
  const output = getResultStructuredOutput(message);
  if (output !== undefined) state.structuredOutput = output;
  const error = getResultError(message);
  if (!error) return success(undefined);
  if (state.latestSessionId) {
    updateTaskAgentProviderSession(
      context.threadId,
      context.agentId,
      PROVIDER,
      state.latestSessionId,
    );
  }
  const failedRes = markTaskAgentFailed(context, error, state.latestSessionId);
  return failedRes.success ? failure(error) : failure(failedRes.error);
}

function writeClaudeSessionEvent(
  context: TaskAgentProgressContext,
  message: SDKMessage,
) {
  const event = summarizeClaudeSessionEvent(message);
  if (!event) return;
  writeTaskAgentSessionEvent(
    context,
    event.source,
    event.kind,
    event.content,
    event.metadata,
  );
}

function completeClaudeTurn(
  input: RunTaskClaudeTurnInput,
  started: StartedTaskAgentRun,
  state: ClaudeTurnState,
): Result<RunTaskClaudeTurnOutput> {
  const sessionRes = saveClaudeSession(input, state.latestSessionId);
  if (!sessionRes.success) return sessionRes;
  const assistantText = formatClaudeAssistantText(state);
  const outputRes = saveTaskAgentOutput(
    input,
    PROVIDER,
    assistantText,
    started.progressContext,
    state.latestSessionId,
  );
  if (!outputRes.success) return outputRes;

  const finishedRun = finishTaskAgentSuccess(
    started.progressContext,
    outputRes.data,
    state.latestSessionId,
  );
  if (!finishedRun.success) return finishedRun;

  return success({
    run: finishedRun.data,
    providerSessionId: state.latestSessionId,
    usedResume: started.usedResume,
    assistantText,
    structuredOutput: state.structuredOutput,
    outputArtifactIds: outputRes.data,
  });
}

function completeCancelledClaudeTurn(
  started: StartedTaskAgentRun,
  state?: ClaudeTurnState,
): Result<RunTaskClaudeTurnOutput> {
  const runRes = completeTaskAgentCancellation(
    started.progressContext,
    'Claude Agent 运行已中断，跳过保存输出。',
  );
  if (!runRes.success) return runRes;
  return success({
    run: runRes.data,
    providerSessionId:
      state?.latestSessionId || started.binding.providerSessionId,
    usedResume: started.usedResume,
    assistantText: '',
    structuredOutput: undefined,
    outputArtifactIds: [],
  });
}

function failClaudeTurn(
  context: TaskAgentProgressContext,
  error: unknown,
  providerSessionIdAtEnd?: string,
): Result<never> {
  const message = error instanceof Error ? error.message : String(error);
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
    ? failure(`Claude Agent 执行失败: ${message}`)
    : failure(failedRes.error);
}

function writeClaudeProgress(
  context: TaskAgentProgressContext,
  message: SDKMessage,
) {
  const progress = summarizeClaudeProgress(message);
  if (!progress) return;
  writeTaskAgentProgress(
    context,
    progress.phase,
    progress.summary,
    progress.detail,
  );
}

function saveClaudeSession(
  input: RunTaskClaudeTurnInput,
  latestSessionId?: string,
): Result<void> {
  if (!latestSessionId) return success(undefined);
  return updateTaskAgentProviderSession(
    input.threadId,
    input.agentId,
    PROVIDER,
    latestSessionId,
  );
}

function formatClaudeAssistantText(state: ClaudeTurnState): string {
  return (
    state.finalResultText ||
    state.assistantTextParts.join('\n\n') ||
    (state.structuredOutput === undefined
      ? ''
      : JSON.stringify(state.structuredOutput, null, 2))
  ).trim();
}
