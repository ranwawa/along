import { spawnSync } from 'node:child_process';
import { Codex, type ThreadOptions } from '@openai/codex-sdk';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import type {
  RunTaskClaudeTurnInput,
  RunTaskClaudeTurnOutput,
} from './task-claude-runner';
import {
  AGENT_RUN_STATUS,
  createTaskAgentRun,
  ensureTaskAgentBinding,
  finishTaskAgentRun,
  recordTaskAgentResult,
  updateTaskAgentProviderSession,
} from './task-planning';

const PROVIDER = 'codex';

interface UnknownRecord {
  [key: string]: unknown;
}

export interface TaskCodexTurn {
  finalResponse: string;
  items: unknown[];
  usage: unknown;
}

export interface TaskCodexThread {
  readonly id: string | null;
  run(
    input: string,
    options?: { outputSchema?: unknown },
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

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getCodexOutputSchema(input: RunTaskCodexTurnInput): unknown {
  const options = input.options as unknown;
  if (!isRecord(options)) return undefined;
  const outputFormat = options.outputFormat;
  if (!isRecord(outputFormat)) return undefined;
  return outputFormat.type === 'json_schema' ? outputFormat.schema : undefined;
}

function parseStructuredOutput(text: string, schema: unknown): unknown {
  if (schema === undefined) return undefined;
  const raw = text.trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function collectAgentMessageText(items: unknown[]): string {
  return items
    .flatMap((item) => {
      if (!isRecord(item)) return [];
      return item.type === 'agent_message' && typeof item.text === 'string'
        ? [item.text]
        : [];
    })
    .join('\n\n')
    .trim();
}

function getAssistantText(turn: TaskCodexTurn): string {
  const finalResponse = turn.finalResponse.trim();
  if (finalResponse) return finalResponse;
  const agentMessages = collectAgentMessageText(turn.items);
  if (agentMessages) return agentMessages;
  return turn.items.length > 0 ? JSON.stringify(turn.items, null, 2) : '';
}

function buildThreadOptions(input: RunTaskCodexTurnInput): ThreadOptions {
  return {
    model: input.model,
    workingDirectory: input.cwd,
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'never',
  };
}

function findCodexExecutable(): string | undefined {
  if (process.env.CODEX_PATH?.trim()) {
    return process.env.CODEX_PATH.trim();
  }

  const command = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(command, ['codex'], {
    encoding: 'utf-8',
    shell: false,
  });
  if (result.status !== 0) return undefined;

  const firstMatch = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstMatch || undefined;
}

function createDefaultClient(): TaskCodexClient {
  const codexPath = findCodexExecutable();
  return codexPath ? new Codex({ codexPathOverride: codexPath }) : new Codex();
}

function failRun(
  runId: string,
  error: string,
  providerSessionIdAtEnd?: string,
): Result<never> {
  const failedRun = finishTaskAgentRun({
    runId,
    status: AGENT_RUN_STATUS.FAILED,
    providerSessionIdAtEnd,
    error,
  });
  return failedRun.success ? failure(error) : failure(failedRun.error);
}

export async function runTaskCodexTurn(
  input: RunTaskCodexTurnInput,
): Promise<Result<RunTaskClaudeTurnOutput>> {
  const prompt = input.prompt.trim();
  if (!prompt) return failure('Codex prompt 不能为空');

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

  const outputSchema = getCodexOutputSchema(input);
  let thread: TaskCodexThread | undefined;
  let latestThreadId = binding.providerSessionId;

  try {
    const client = (input.createClient || createDefaultClient)();
    thread = binding.providerSessionId
      ? client.resumeThread(
          binding.providerSessionId,
          buildThreadOptions(input),
        )
      : client.startThread(buildThreadOptions(input));

    const turn = await thread.run(prompt, { outputSchema });
    latestThreadId = thread.id || binding.providerSessionId;
    if (latestThreadId) {
      const updateRes = updateTaskAgentProviderSession(
        input.threadId,
        input.agentId,
        PROVIDER,
        latestThreadId,
      );
      if (!updateRes.success) {
        return failRun(runRes.data.runId, updateRes.error, latestThreadId);
      }
    }

    const assistantText = getAssistantText(turn);
    const structuredOutput = parseStructuredOutput(assistantText, outputSchema);
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
          providerSessionIdAtEnd: latestThreadId,
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
      providerSessionIdAtEnd: latestThreadId,
      outputArtifactIds,
    });
    if (!finishedRun.success) return finishedRun;

    return success({
      run: finishedRun.data,
      providerSessionId: latestThreadId,
      usedResume,
      assistantText,
      structuredOutput,
      outputArtifactIds,
    });
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    const failedRun = finishTaskAgentRun({
      runId: runRes.data.runId,
      status: AGENT_RUN_STATUS.FAILED,
      providerSessionIdAtEnd: thread?.id || latestThreadId,
      error: message,
    });
    if (!failedRun.success) return failedRun;
    return failure(`Codex Agent 执行失败: ${message}`);
  }
}
