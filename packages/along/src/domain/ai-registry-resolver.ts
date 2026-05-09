// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: resolver functions intentionally keep precedence chains explicit.
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  type AgentConfig,
  type CredentialConfig,
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
  credentialId?: string;
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
  credentialId: string;
  token: string;
  tokenEnv?: string;
  personalityVersion?: string;
}

export interface ResolveProfileLlmInput {
  registry: RegistryConfig;
  profileId: string;
  credentialId?: string;
}

export interface ResolvedProfileLlmConfig {
  profileId: string;
  providerId: string;
  providerKind: ProviderKind;
  baseUrl?: string;
  model: string;
  credentialId: string;
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

interface ResolveCredentialInput {
  registry: RegistryConfig;
  providerId: string;
  credentialId?: string;
}

function resolveToken(credential: CredentialConfig): Result<string> {
  if (credential.tokenEnv) {
    const token = process.env[credential.tokenEnv];
    return token
      ? success(token)
      : failure(
          `Credential ${credential.id} 未解析到环境变量: ${credential.tokenEnv}`,
        );
  }
  return credential.token
    ? success(credential.token)
    : failure(`Credential ${credential.id} 未解析到 token`);
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

function resolveCredential(
  input: ResolveCredentialInput,
): Result<CredentialConfig> {
  if (!input.credentialId) {
    return failure(`Provider ${input.providerId} 缺少 credential`);
  }
  const credentialRes = requireItem(
    input.registry.credentials,
    input.credentialId,
    'Credential',
  );
  if (!credentialRes.success) return credentialRes;
  if (credentialRes.data.providerId !== input.providerId) {
    return failure(
      `Credential ${credentialRes.data.id} 不属于 Provider: ${input.providerId}`,
    );
  }
  return credentialRes;
}

function resolveRuntime(
  registry: RegistryConfig,
  agent: AgentConfig,
): Result<RuntimeConfig> {
  return requireItem(registry.runtimes, agent.runtimeId, 'Runtime');
}

function resolveProviderModelCredential(input: {
  registry: RegistryConfig;
  model: ModelConfig;
  credentialId?: string;
}): Result<{
  providerId: string;
  providerKind: ProviderKind;
  baseUrl?: string;
  credential: CredentialConfig;
  token: string;
}> {
  const providerRes = requireItem(
    input.registry.providers,
    input.model.providerId,
    'Provider',
  );
  if (!providerRes.success) return providerRes;

  const credentialRes = resolveCredential({
    registry: input.registry,
    providerId: providerRes.data.id,
    credentialId:
      input.credentialId ||
      input.model.credentialId ||
      providerRes.data.defaultCredentialId,
  });
  if (!credentialRes.success) return credentialRes;

  const tokenRes = resolveToken(credentialRes.data);
  if (!tokenRes.success) return tokenRes;

  return success({
    providerId: providerRes.data.id,
    providerKind: providerRes.data.kind,
    baseUrl: providerRes.data.baseUrl,
    credential: credentialRes.data,
    token: tokenRes.data,
  });
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
    input.modelId || agentRes.data.modelId || runtimeRes.data.modelId,
    `Agent ${input.agentId}`,
  );
  if (!modelRes.success) return modelRes;

  const resolvedRes = resolveProviderModelCredential({
    registry: input.registry,
    model: modelRes.data,
    credentialId:
      input.credentialId ||
      agentRes.data.credentialId ||
      runtimeRes.data.credentialId,
  });
  if (!resolvedRes.success) return resolvedRes;

  return success({
    agentId: agentRes.data.id,
    runtimeId: runtimeRes.data.id,
    runtimeKind: runtimeRes.data.kind,
    providerId: resolvedRes.data.providerId,
    providerKind: resolvedRes.data.providerKind,
    baseUrl: resolvedRes.data.baseUrl,
    model: modelRes.data.model,
    modelId: modelRes.data.id,
    credentialId: resolvedRes.data.credential.id,
    token: resolvedRes.data.token,
    tokenEnv: resolvedRes.data.credential.tokenEnv,
    personalityVersion: agentRes.data.personalityVersion,
  });
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

  const resolvedRes = resolveProviderModelCredential({
    registry: input.registry,
    model: modelRes.data,
    credentialId: input.credentialId || profile.credentialId,
  });
  if (!resolvedRes.success) return resolvedRes;

  return success({
    profileId: profile.id,
    providerId: resolvedRes.data.providerId,
    providerKind: resolvedRes.data.providerKind,
    baseUrl: resolvedRes.data.baseUrl,
    model: modelRes.data.model,
    credentialId: resolvedRes.data.credential.id,
    token: resolvedRes.data.token,
    tokenEnv: resolvedRes.data.credential.tokenEnv,
    systemPrompt: profile.systemPrompt,
    userTemplate: profile.userTemplate,
    parameters: {
      ...profile.parameters,
      outputFormat: profile.parameters?.outputFormat || 'text',
    },
  });
}
