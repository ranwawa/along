import { spawnSync } from 'node:child_process';
import { Codex, type ThreadOptions } from '@openai/codex-sdk';
import type {
  RunTaskCodexTurnInput,
  TaskCodexClient,
  TaskCodexTurn,
} from './task-codex-runner';

interface UnknownRecord {
  [key: string]: unknown;
}

const DEFAULT_CODEX_TURN_TIMEOUT_MINUTES = 30;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_MINUTE = 60_000;
const DEFAULT_CODEX_TURN_TIMEOUT_MS =
  DEFAULT_CODEX_TURN_TIMEOUT_MINUTES *
  SECONDS_PER_MINUTE *
  MILLISECONDS_PER_SECOND;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getCodexOutputSchema(input: RunTaskCodexTurnInput): unknown {
  const options = input.options as unknown;
  if (!isRecord(options)) return undefined;
  const outputFormat = options.outputFormat;
  if (!isRecord(outputFormat)) return undefined;
  return outputFormat.type === 'json_schema' ? outputFormat.schema : undefined;
}

export function parseStructuredOutput(text: string, schema: unknown): unknown {
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

export function getCodexAssistantText(turn: TaskCodexTurn): string {
  const finalResponse = turn.finalResponse.trim();
  if (finalResponse) return finalResponse;
  const agentMessages = collectAgentMessageText(turn.items);
  if (agentMessages) return agentMessages;
  return turn.items.length > 0 ? JSON.stringify(turn.items, null, 2) : '';
}

export function buildThreadOptions(
  input: RunTaskCodexTurnInput,
): ThreadOptions {
  return {
    model: input.model,
    workingDirectory: input.cwd,
    sandboxMode: input.codexOptions?.sandboxMode || 'danger-full-access',
    approvalPolicy: input.codexOptions?.approvalPolicy || 'never',
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

export function createCodexClient(
  input: RunTaskCodexTurnInput,
): TaskCodexClient {
  const codexPath = findCodexExecutable();
  return new Codex({
    ...(codexPath ? { codexPathOverride: codexPath } : {}),
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
  });
}

export function readCodexTurnTimeoutMs(): number {
  const raw = Number(process.env.ALONG_TASK_AGENT_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_CODEX_TURN_TIMEOUT_MS;
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / MILLISECONDS_PER_MINUTE);
  return minutes >= 1 ? `${minutes} 分钟` : `${ms} ms`;
}
