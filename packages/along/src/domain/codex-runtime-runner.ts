import type { Result } from '../core/result';
import {
  type CodexOutputFormatOptions,
  type RunTaskCodexTurnOutput,
  runTaskCodexTurn,
} from './task-codex-runner';

export interface RunCodexRuntimeTurnInput {
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
  codexOptions?: {
    sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
    approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never';
  };
}

export type RunCodexRuntimeTurnOutput = RunTaskCodexTurnOutput;

export const CodexRuntimeRunner = {
  runAgentTurn(
    input: RunCodexRuntimeTurnInput,
  ): Promise<Result<RunCodexRuntimeTurnOutput>> {
    return runTaskCodexTurn(input);
  },
};
