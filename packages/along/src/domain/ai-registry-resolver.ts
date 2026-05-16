import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  type AgentConfig,
  getRegistryItemById,
  type ModelConfig,
  type ProfileConfig,
  type ProviderKind,
  type RegistryConfig,
  type RuntimeConfig,
} from './ai-registry-config';

export interface ResolveAgentRuntimeInput {
  registry: RegistryConfig;
  agentId: string;
  modelId?: string;
}

export interface ResolvedAgentRuntimeConfig {
  agentId: string;
  runtimeId: string;
  runtimeKind: 'codex';
  providerId: string;
  providerKind: ProviderKind;
  baseUrl?: string;
  model: string;
  modelId: string;
  token: string;
  tokenEnv?: string;
  personalityVersion?: string;
}

export interface ResolveProfileLlmInput {
  registry: RegistryConfig;
  profileId: string;
}

export interface ResolvedProfileLlmConfig {
  profileId: string;
  providerId: string;
  providerKind: ProviderKind;
  baseUrl?: string;
  model: string;
  token: string;
  tokenEnv?: string;
  systemPrompt: string;
  userTemplate?: string;
  parameters: {
    temperature?: number;
    maxTokens?: number;
    outputFormat: 'text' | 'json';
  };
}

function resolveToken(model: ModelConfig): Result<string> {
  if (model.tokenEnv) {
    const token = process.env[model.tokenEnv];
    return token
      ? success(token)
      : failure(`Model ${model.id} 未解析到环境变量: ${model.tokenEnv}`);
  }
  return model.token
    ? success(model.token)
    : failure(`Model ${model.id} 未配置 token 或 tokenEnv`);
}

function requireItem<T extends { id: string }>(
  items: T[],
  id: string,
  label: string,
): Result<T> {
  const item = getRegistryItemById(items, id);
  return item ? success(item) : failure(`未知 ${label}: ${id}`);
}

function resolveModel(
  registry: RegistryConfig,
  modelId: string | undefined,
  label: string,
): Result<ModelConfig> {
  if (!modelId) return failure(`${label} 缺少 modelId`);
  return requireItem(registry.models, modelId, 'Model');
}

function resolveRuntime(
  registry: RegistryConfig,
  agent: AgentConfig,
): Result<RuntimeConfig> {
  return requireItem(registry.runtimes, agent.runtimeId, 'Runtime');
}

function resolveProviderModelToken(input: {
  registry: RegistryConfig;
  model: ModelConfig;
}): Result<{
  providerId: string;
  providerKind: ProviderKind;
  baseUrl?: string;
  token: string;
}> {
  const providerRes = requireItem(
    input.registry.providers,
    input.model.providerId,
    'Provider',
  );
  if (!providerRes.success) return providerRes;

  const tokenRes = resolveToken(input.model);
  if (!tokenRes.success) return tokenRes;

  return success({
    providerId: providerRes.data.id,
    providerKind: providerRes.data.kind,
    baseUrl: providerRes.data.baseUrl,
    token: tokenRes.data,
  });
}

function resolveAgentModelId(
  input: ResolveAgentRuntimeInput,
  agent: AgentConfig,
  runtime: RuntimeConfig,
): string | undefined {
  return input.modelId || agent.modelId || runtime.modelId;
}

export function resolveAgentRuntimeConfig(
  input: ResolveAgentRuntimeInput,
): Result<ResolvedAgentRuntimeConfig> {
  const agentRes = requireItem(input.registry.agents, input.agentId, 'Agent');
  if (!agentRes.success) return agentRes;

  const runtimeRes = resolveRuntime(input.registry, agentRes.data);
  if (!runtimeRes.success) return runtimeRes;

  const modelRes = resolveModel(
    input.registry,
    resolveAgentModelId(input, agentRes.data, runtimeRes.data),
    `Agent ${input.agentId}`,
  );
  if (!modelRes.success) return modelRes;

  const resolvedRes = resolveProviderModelToken({
    registry: input.registry,
    model: modelRes.data,
  });
  if (!resolvedRes.success) return resolvedRes;

  return success({
    agentId: agentRes.data.id,
    runtimeId: runtimeRes.data.id,
    runtimeKind: runtimeRes.data.kind,
    ...resolvedRes.data,
    model: modelRes.data.model,
    modelId: modelRes.data.id,
    tokenEnv: modelRes.data.tokenEnv,
    personalityVersion: agentRes.data.personalityVersion,
  });
}

function buildProfileParameters(
  profile: ProfileConfig,
): ResolvedProfileLlmConfig['parameters'] {
  return {
    ...profile.parameters,
    outputFormat: profile.parameters?.outputFormat || 'text',
  };
}

export function resolveProfileLlmConfig(
  input: ResolveProfileLlmInput,
): Result<ResolvedProfileLlmConfig> {
  const profileRes = requireItem(
    input.registry.profiles,
    input.profileId,
    'Profile',
  );
  if (!profileRes.success) return profileRes;
  const profile: ProfileConfig = profileRes.data;

  const modelRes = resolveModel(
    input.registry,
    profile.modelId,
    `Profile ${profile.id}`,
  );
  if (!modelRes.success) return modelRes;

  const resolvedRes = resolveProviderModelToken({
    registry: input.registry,
    model: modelRes.data,
  });
  if (!resolvedRes.success) return resolvedRes;

  return success({
    profileId: profile.id,
    ...resolvedRes.data,
    model: modelRes.data.model,
    tokenEnv: modelRes.data.tokenEnv,
    systemPrompt: profile.systemPrompt,
    userTemplate: profile.userTemplate,
    parameters: buildProfileParameters(profile),
  });
}
