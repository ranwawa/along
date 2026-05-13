import type { Result } from '../core/result';
import { failure } from '../core/result';
import { readRegistryConfig } from '../integration/ai-registry-store';
import {
  type ResolvedAgentRuntimeConfig,
  resolveAgentRuntimeConfig,
} from './ai-registry-resolver';
import {
  CodexRuntimeRunner,
  type RunCodexRuntimeTurnOutput,
} from './codex-runtime-runner';
import type { CodexOutputFormatOptions } from './task-codex-runner';

export interface RunAgentTurnInput {
  taskId: string;
  threadId: string;
  agentId: string;
  prompt: string;
  cwd: string;
  modelId?: string;
  personalityVersion?: string;
  inputArtifactIds?: string[];
  outputMetadata?: Record<string, unknown>;
  codexOptions?: {
    sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
    approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never';
  };
  options?: CodexOutputFormatOptions;
}

export type RunAgentTurnOutput = RunCodexRuntimeTurnOutput;

export interface RuntimeServiceDependencies {
  readRegistry?: typeof readRegistryConfig;
  runCodexAgentTurn?: typeof CodexRuntimeRunner.runAgentTurn;
}

export function resolveRuntimeForAgent(input: {
  agentId: string;
  modelId?: string;
  dependencies?: RuntimeServiceDependencies;
}): Result<ResolvedAgentRuntimeConfig> {
  const readRegistry = input.dependencies?.readRegistry || readRegistryConfig;
  const registryRes = readRegistry();
  if (!registryRes.success) return registryRes;
  return resolveAgentRuntimeConfig({
    registry: registryRes.data,
    agentId: input.agentId,
    modelId: input.modelId,
  });
}

export async function runAgentTurn(
  input: RunAgentTurnInput,
  dependencies: RuntimeServiceDependencies = {},
): Promise<Result<RunAgentTurnOutput>> {
  const runtimeRes = resolveRuntimeForAgent({
    agentId: input.agentId,
    modelId: input.modelId,
    dependencies,
  });
  if (!runtimeRes.success) return runtimeRes;

  if (runtimeRes.data.runtimeKind !== 'codex') {
    return failure(
      `仅支持 Codex runtime，当前配置为 ${runtimeRes.data.runtimeKind}`,
    );
  }

  const runCodexAgentTurn =
    dependencies.runCodexAgentTurn || CodexRuntimeRunner.runAgentTurn;
  return runCodexAgentTurn({
    ...input,
    model: runtimeRes.data.model,
    baseUrl: runtimeRes.data.baseUrl,
    apiKey: runtimeRes.data.token,
    personalityVersion:
      input.personalityVersion || runtimeRes.data.personalityVersion,
  });
}

export const RuntimeService = {
  resolveRuntimeForAgent,
  runAgentTurn,
};
