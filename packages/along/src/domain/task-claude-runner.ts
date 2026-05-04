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
} from './task-agent-progress';
import {
  finishTaskAgentSuccess,
  markTaskAgentFailed,
  type StartedTaskAgentRun,
  saveTaskAgentOutput,
  startTaskAgentRun,
  startTaskAgentRunHeartbeat,
} from './task-agent-run-lifecycle';
import {
  getAssistantMessageText,
  getResultError,
  getResultStructuredOutput,
  getResultText,
  getSessionId,
  summarizeClaudeProgress,
} from './task-claude-messages';
import {
  type TaskAgentRunRecord,
  updateTaskAgentProviderSession,
} from './task-planning';

const PROVIDER = 'claude';

export interface RunTaskClaudeTurnInput {
  taskId: string;
  threadId: string;
  agentId: string;
  prompt: string;
  cwd: string;
  model?: string;
  personalityVersion?: string;
  inputArtifactIds?: string[];
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

function buildOptions(
  input: RunTaskClaudeTurnInput,
  resumeSessionId?: string,
): ClaudeSDKOptions {
  return {
    ...input.options,
    cwd: input.cwd,
    model: input.model,
    resume: resumeSessionId,
    permissionMode: input.options?.permissionMode || 'plan',
    maxTurns: input.options?.maxTurns || 50,
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
  const stopHeartbeat = startTaskAgentRunHeartbeat(
    started.progressContext,
    started.usedResume
      ? 'Agent 已启动，正在恢复上次会话。'
      : 'Agent 已启动，正在准备任务上下文。',
    input.cwd,
  );

  try {
    const conversation = query({
      prompt,
      options: buildOptions(input, started.binding.providerSessionId),
    });
    const stateRes = await collectClaudeConversation(
      conversation,
      started.progressContext,
      started.binding.providerSessionId,
    );
    if (!stateRes.success) return stateRes;
    return completeClaudeTurn(input, started, stateRes.data);
  } catch (error: unknown) {
    return failClaudeTurn(
      started.progressContext,
      error,
      started.binding.providerSessionId,
    );
  } finally {
    stopHeartbeat();
  }
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
  writeClaudeProgress(context, message);
  state.assistantTextParts.push(...getAssistantMessageText(message));
  const resultText = getResultText(message);
  if (resultText) state.finalResultText = resultText;
  const output = getResultStructuredOutput(message);
  if (output !== undefined) state.structuredOutput = output;
  const error = getResultError(message);
  if (!error) return success(undefined);
  const failedRes = markTaskAgentFailed(context, error, state.latestSessionId);
  return failedRes.success ? failure(error) : failure(failedRes.error);
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

function failClaudeTurn(
  context: TaskAgentProgressContext,
  error: unknown,
  providerSessionIdAtEnd?: string,
): Result<never> {
  const message = error instanceof Error ? error.message : String(error);
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
