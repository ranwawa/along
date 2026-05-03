import type { Options as ClaudeSDKOptions } from '@anthropic-ai/claude-agent-sdk';
import type { Result } from '../core/result';
import { getTaskAgentConfig } from '../integration/agent-config';
import {
  type RunTaskClaudeTurnOutput,
  runTaskClaudeTurn,
} from './task-claude-runner';
import { runTaskCodexTurn } from './task-codex-runner';
import { runTaskSpawnTurn } from './task-spawn-runner';

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
  options?: Partial<ClaudeSDKOptions>;
}

export type RunTaskAgentTurnOutput = RunTaskClaudeTurnOutput;

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
    editor: input.editor || configured?.editor || 'claude',
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

  if (runtime.editor === 'claude') {
    return runTaskClaudeTurn(resolvedInput);
  }

  if (runtime.editor === 'codex') {
    return runTaskCodexTurn(resolvedInput);
  }

  return runTaskSpawnTurn({ ...resolvedInput, editor: runtime.editor });
}
