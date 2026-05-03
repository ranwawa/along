import {
  type Options as ClaudeSDKOptions,
  query,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  AGENT_RUN_STATUS,
  createTaskAgentRun,
  ensureTaskAgentBinding,
  finishTaskAgentRun,
  recordTaskAgentResult,
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

type MessageWithSession = SDKMessage & { session_id?: string };
type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getSessionId(message: SDKMessage): string | undefined {
  const candidate = message as MessageWithSession;
  return typeof candidate.session_id === 'string'
    ? candidate.session_id
    : undefined;
}

function getResultError(message: SDKMessage): string | null {
  const result = message as {
    type?: string;
    is_error?: boolean;
    errors?: unknown;
    subtype?: string;
  };
  if (result.type !== 'result') return null;
  if (result.is_error !== true) return null;

  if (Array.isArray(result.errors)) {
    const errors = result.errors
      .filter((item): item is string => typeof item === 'string')
      .join(', ');
    return errors || 'Claude Agent 返回错误结果';
  }

  return typeof result.subtype === 'string'
    ? `Claude Agent 返回错误结果: ${result.subtype}`
    : 'Claude Agent 返回错误结果';
}

function collectTextBlocks(content: unknown): string[] {
  if (!Array.isArray(content)) return [];

  return content.flatMap((block) => {
    if (!isRecord(block)) return [];
    return block.type === 'text' && typeof block.text === 'string'
      ? [block.text]
      : [];
  });
}

function getAssistantMessageText(message: SDKMessage): string[] {
  const record: unknown = message;
  if (!isRecord(record) || record.type !== 'assistant') return [];
  if (!isRecord(record.message)) return [];
  return collectTextBlocks(record.message.content);
}

function getResultText(message: SDKMessage): string | undefined {
  const record: unknown = message;
  if (!isRecord(record) || record.type !== 'result') return undefined;
  return typeof record.result === 'string' ? record.result : undefined;
}

function getResultStructuredOutput(message: SDKMessage): unknown {
  const record: unknown = message;
  if (!isRecord(record) || record.type !== 'result') return undefined;
  return record.structured_output;
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

  const bindingRes = ensureTaskAgentBinding({
    threadId: input.threadId,
    agentId: input.agentId,
    provider: PROVIDER,
    cwd: input.cwd,
    model: input.model,
    personalityVersion: input.personalityVersion,
  });
  if (!bindingRes.success) return bindingRes;

  const binding = bindingRes.data;
  const usedResume = Boolean(binding.providerSessionId);

  const runRes = createTaskAgentRun({
    taskId: input.taskId,
    threadId: input.threadId,
    agentId: input.agentId,
    provider: PROVIDER,
    providerSessionIdAtStart: binding.providerSessionId,
    inputArtifactIds: input.inputArtifactIds,
  });
  if (!runRes.success) return runRes;

  let latestSessionId = binding.providerSessionId;
  const assistantTextParts: string[] = [];
  let finalResultText: string | undefined;
  let structuredOutput: unknown;

  try {
    const conversation = query({
      prompt,
      options: buildOptions(input, binding.providerSessionId),
    });

    for await (const message of conversation) {
      const sessionId = getSessionId(message);
      if (sessionId) latestSessionId = sessionId;

      assistantTextParts.push(...getAssistantMessageText(message));
      const resultText = getResultText(message);
      if (resultText) finalResultText = resultText;
      const resultStructuredOutput = getResultStructuredOutput(message);
      if (resultStructuredOutput !== undefined) {
        structuredOutput = resultStructuredOutput;
      }

      const error = getResultError(message);
      if (error) {
        const failedRun = finishTaskAgentRun({
          runId: runRes.data.runId,
          status: AGENT_RUN_STATUS.FAILED,
          providerSessionIdAtEnd: latestSessionId,
          error,
        });
        if (!failedRun.success) return failedRun;
        return failure(error);
      }
    }

    if (latestSessionId) {
      const updateRes = updateTaskAgentProviderSession(
        input.threadId,
        input.agentId,
        PROVIDER,
        latestSessionId,
      );
      if (!updateRes.success) return updateRes;
    }

    const assistantText = (
      finalResultText ||
      assistantTextParts.join('\n\n') ||
      (structuredOutput === undefined
        ? ''
        : JSON.stringify(structuredOutput, null, 2))
    ).trim();
    const outputArtifactIds: string[] = [];
    if (assistantText) {
      const artifactRes = recordTaskAgentResult({
        taskId: input.taskId,
        threadId: input.threadId,
        agentId: input.agentId,
        provider: PROVIDER,
        runId: runRes.data.runId,
        body: assistantText,
      });
      if (!artifactRes.success) {
        const failedRun = finishTaskAgentRun({
          runId: runRes.data.runId,
          status: AGENT_RUN_STATUS.FAILED,
          providerSessionIdAtEnd: latestSessionId,
          error: artifactRes.error,
        });
        if (!failedRun.success) return failedRun;
        return failure(artifactRes.error);
      }
      outputArtifactIds.push(artifactRes.data.artifactId);
    }

    const finishedRun = finishTaskAgentRun({
      runId: runRes.data.runId,
      status: AGENT_RUN_STATUS.SUCCEEDED,
      providerSessionIdAtEnd: latestSessionId,
      outputArtifactIds,
    });
    if (!finishedRun.success) return finishedRun;

    return success({
      run: finishedRun.data,
      providerSessionId: latestSessionId,
      usedResume,
      assistantText,
      structuredOutput,
      outputArtifactIds,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const failedRun = finishTaskAgentRun({
      runId: runRes.data.runId,
      status: AGENT_RUN_STATUS.FAILED,
      providerSessionIdAtEnd: latestSessionId,
      error: message,
    });
    if (!failedRun.success) return failedRun;
    return failure(`Claude Agent 执行失败: ${message}`);
  }
}
