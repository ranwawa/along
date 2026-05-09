import type { Result } from '../core/result';
import { failure } from '../core/result';
import { getTaskAgentConfig } from '../integration/agent-config';
import {
  type CodexOutputFormatOptions,
  type RunTaskCodexTurnOutput,
  runTaskCodexTurn,
} from './task-codex-runner';

export interface RunTaskAgentTurnInput {
  taskId: string;
  threadId: string;
  agentId: string;
  prompt: string;
  cwd: string;
  editor?: string;
  model?: string;
  personalityVersion?: string;
  inputArtifactIds?: string[];
  outputMetadata?: Record<string, unknown>;
  codexOptions?: {
    sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
    approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never';
  };
  options?: CodexOutputFormatOptions;
}

export type RunTaskAgentTurnOutput = RunTaskCodexTurnOutput;

export interface ResolvedTaskAgentRuntime {
  agentId: string;
  editor: string;
  model?: string;
  personalityVersion?: string;
}

export function resolveTaskAgentRuntime(input: {
  agentId: string;
  editor?: string;
  model?: string;
  personalityVersion?: string;
}): ResolvedTaskAgentRuntime {
  const configured = getTaskAgentConfig(input.agentId);
  return {
    agentId: input.agentId,
    editor: input.editor || configured?.editor || 'codex',
    model: input.model || configured?.model,
    personalityVersion:
      input.personalityVersion || configured?.personalityVersion,
  };
}

export async function runTaskAgentTurn(
  input: RunTaskAgentTurnInput,
): Promise<Result<RunTaskAgentTurnOutput>> {
  const runtime = resolveTaskAgentRuntime({
    agentId: input.agentId,
    editor: input.editor,
    model: input.model,
    personalityVersion: input.personalityVersion,
  });

  const resolvedInput = {
    ...input,
    model: runtime.model,
    personalityVersion: runtime.personalityVersion,
  };

  if (runtime.editor === 'codex') {
    return runTaskCodexTurn(resolvedInput);
  }

  return failure(`仅支持 Codex editor，当前配置为 ${runtime.editor}`);
}
