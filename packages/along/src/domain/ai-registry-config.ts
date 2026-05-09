// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: registry validation keeps cross-entity invariants together.
import { z } from 'zod';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import { migrateLegacyRegistryConfig } from './ai-registry-legacy-config';

export type ProviderKind = 'openai-compatible' | 'anthropic' | 'custom';

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name?: string;
  baseUrl?: string;
  defaultCredentialId?: string;
}

export interface CredentialConfig {
  id: string;
  providerId: string;
  name?: string;
  token?: string;
  tokenEnv?: string;
}

export interface ModelConfig {
  id: string;
  providerId: string;
  model: string;
  name?: string;
  credentialId?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface RuntimeConfig {
  id: string;
  kind: 'codex';
  name?: string;
  modelId?: string;
  credentialId?: string;
}

export interface AgentConfig {
  id: string;
  runtimeId: string;
  name?: string;
  modelId?: string;
  credentialId?: string;
  personalityVersion?: string;
}

export interface ProfileParametersConfig {
  temperature?: number;
  maxTokens?: number;
  outputFormat?: 'text' | 'json';
}

export interface ProfileConfig {
  id: string;
  modelId: string;
  name?: string;
  credentialId?: string;
  systemPrompt: string;
  userTemplate?: string;
  parameters?: ProfileParametersConfig;
}

export interface RegistryConfig {
  providers: ProviderConfig[];
  credentials: CredentialConfig[];
  models: ModelConfig[];
  runtimes: RuntimeConfig[];
  agents: AgentConfig[];
  profiles: ProfileConfig[];
}

const idSchema = z.string().trim().min(1);

const providerSchema = z.object({
  id: idSchema,
  kind: z.enum(['openai-compatible', 'anthropic', 'custom']),
  name: z.string().trim().min(1).optional(),
  baseUrl: z.string().trim().min(1).optional(),
  defaultCredentialId: idSchema.optional(),
});

const credentialSchema = z
  .object({
    id: idSchema,
    providerId: idSchema,
    name: z.string().trim().min(1).optional(),
    token: z.string().trim().min(1).optional(),
    tokenEnv: z.string().trim().min(1).optional(),
  })
  .refine((value) => value.token || value.tokenEnv, {
    message: 'Credential 必须配置 token 或 tokenEnv',
  });

const modelSchema = z.object({
  id: idSchema,
  providerId: idSchema,
  model: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  credentialId: idSchema.optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});

const runtimeSchema = z.object({
  id: idSchema,
  kind: z.literal('codex'),
  name: z.string().trim().min(1).optional(),
  modelId: idSchema.optional(),
  credentialId: idSchema.optional(),
});

const agentSchema = z.object({
  id: idSchema,
  runtimeId: idSchema,
  name: z.string().trim().min(1).optional(),
  modelId: idSchema.optional(),
  credentialId: idSchema.optional(),
  personalityVersion: z.string().trim().min(1).optional(),
});

const profileSchema = z.object({
  id: idSchema,
  modelId: idSchema,
  name: z.string().trim().min(1).optional(),
  credentialId: idSchema.optional(),
  systemPrompt: z.string().trim().min(1),
  userTemplate: z.string().optional(),
  parameters: z
    .object({
      temperature: z.number().nonnegative().optional(),
      maxTokens: z.number().int().positive().optional(),
      outputFormat: z.enum(['text', 'json']).optional(),
    })
    .optional(),
});

export const registrySchema = z.object({
  providers: z.array(providerSchema),
  credentials: z.array(credentialSchema),
  models: z.array(modelSchema),
  runtimes: z.array(runtimeSchema),
  agents: z.array(agentSchema),
  profiles: z.array(profileSchema),
});

function getZodErrorMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'registry'}: ${issue.message}`)
    .join('; ');
}

function findById<T extends { id: string }>(
  items: T[],
  id: string | undefined,
): T | undefined {
  if (!id) return undefined;
  return items.find((item) => item.id === id);
}

function ensureUniqueIds<T extends { id: string }>(
  label: string,
  items: T[],
): Result<void> {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) return failure(`${label} id 重复: ${item.id}`);
    seen.add(item.id);
  }
  return success(undefined);
}

function ensureCredentialProvider(
  registry: RegistryConfig,
  credentialId: string | undefined,
  providerId: string,
  label: string,
): Result<void> {
  if (!credentialId) return success(undefined);
  const credential = findById(registry.credentials, credentialId);
  if (!credential)
    return failure(`${label} 引用了未知 Credential: ${credentialId}`);
  if (credential.providerId !== providerId) {
    return failure(`${label} 引用的 Credential 不属于 Provider: ${providerId}`);
  }
  return success(undefined);
}

function validateModelReference(
  registry: RegistryConfig,
  modelId: string | undefined,
  label: string,
): Result<ModelConfig | undefined> {
  if (!modelId) return success(undefined);
  const model = findById(registry.models, modelId);
  return model
    ? success(model)
    : failure(`${label} 引用了未知 Model: ${modelId}`);
}

function validateRegistryReferences(
  registry: RegistryConfig,
): Result<RegistryConfig> {
  const uniqueChecks = [
    ensureUniqueIds('Provider', registry.providers),
    ensureUniqueIds('Credential', registry.credentials),
    ensureUniqueIds('Model', registry.models),
    ensureUniqueIds('Runtime', registry.runtimes),
    ensureUniqueIds('Agent', registry.agents),
    ensureUniqueIds('Profile', registry.profiles),
  ];
  for (const check of uniqueChecks) if (!check.success) return check;

  for (const provider of registry.providers) {
    const credentialRes = ensureCredentialProvider(
      registry,
      provider.defaultCredentialId,
      provider.id,
      `Provider ${provider.id}`,
    );
    if (!credentialRes.success) return credentialRes;
  }

  for (const credential of registry.credentials) {
    if (!findById(registry.providers, credential.providerId)) {
      return failure(
        `Credential 引用了未知 Provider: ${credential.providerId}`,
      );
    }
  }

  for (const model of registry.models) {
    const provider = findById(registry.providers, model.providerId);
    if (!provider)
      return failure(`Model 引用了未知 Provider: ${model.providerId}`);
    const credentialRes = ensureCredentialProvider(
      registry,
      model.credentialId,
      provider.id,
      `Model ${model.id}`,
    );
    if (!credentialRes.success) return credentialRes;
  }

  for (const runtime of registry.runtimes) {
    const modelRes = validateModelReference(
      registry,
      runtime.modelId,
      `Runtime ${runtime.id}`,
    );
    if (!modelRes.success) return modelRes;
    if (modelRes.data) {
      const credentialRes = ensureCredentialProvider(
        registry,
        runtime.credentialId,
        modelRes.data.providerId,
        `Runtime ${runtime.id}`,
      );
      if (!credentialRes.success) return credentialRes;
    }
  }

  for (const agent of registry.agents) {
    const runtime = findById(registry.runtimes, agent.runtimeId);
    if (!runtime)
      return failure(`Agent 引用了未知 Runtime: ${agent.runtimeId}`);
    const modelRes = validateModelReference(
      registry,
      agent.modelId || runtime.modelId,
      `Agent ${agent.id}`,
    );
    if (!modelRes.success) return modelRes;
    if (modelRes.data) {
      const credentialRes = ensureCredentialProvider(
        registry,
        agent.credentialId || runtime.credentialId,
        modelRes.data.providerId,
        `Agent ${agent.id}`,
      );
      if (!credentialRes.success) return credentialRes;
    }
  }

  for (const profile of registry.profiles) {
    const modelRes = validateModelReference(
      registry,
      profile.modelId,
      `Profile ${profile.id}`,
    );
    if (!modelRes.success) return modelRes;
    if (!modelRes.data) return failure(`Profile 缺少 Model: ${profile.id}`);
    const credentialRes = ensureCredentialProvider(
      registry,
      profile.credentialId,
      modelRes.data.providerId,
      `Profile ${profile.id}`,
    );
    if (!credentialRes.success) return credentialRes;
    const maxTokens = profile.parameters?.maxTokens;
    if (
      maxTokens !== undefined &&
      modelRes.data.maxOutputTokens !== undefined &&
      maxTokens > modelRes.data.maxOutputTokens
    ) {
      return failure(`Profile ${profile.id} maxTokens 超过模型输出上限`);
    }
  }

  return success(registry);
}

export function parseRegistryConfig(value: unknown): Result<RegistryConfig> {
  const parsed = registrySchema.safeParse(value);
  if (!parsed.success) {
    const migrated = migrateLegacyRegistryConfig(value);
    if (migrated) return validateRegistryReferences(migrated);
    return failure(`Registry 配置无效: ${getZodErrorMessage(parsed.error)}`);
  }
  return validateRegistryReferences(parsed.data);
}

export function getRegistryItemById<T extends { id: string }>(
  items: T[],
  id: string,
): T | undefined {
  return findById(items, id);
}
