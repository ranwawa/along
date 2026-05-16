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
}

export interface ModelConfig {
  id: string;
  providerId: string;
  model: string;
  name?: string;
  token?: string;
  tokenEnv?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface RuntimeConfig {
  id: string;
  kind: 'codex';
  name?: string;
  modelId?: string;
}

export interface AgentConfig {
  id: string;
  runtimeId: string;
  name?: string;
  modelId?: string;
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
  systemPrompt: string;
  userTemplate?: string;
  parameters?: ProfileParametersConfig;
}

export interface RegistryConfig {
  providers: ProviderConfig[];
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
});

const modelSchema = z.object({
  id: idSchema,
  providerId: idSchema,
  model: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  token: z.string().trim().min(1).optional(),
  tokenEnv: z.string().trim().min(1).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});

const runtimeSchema = z.object({
  id: idSchema,
  kind: z.literal('codex'),
  name: z.string().trim().min(1).optional(),
  modelId: idSchema.optional(),
});

const agentSchema = z.object({
  id: idSchema,
  runtimeId: idSchema,
  name: z.string().trim().min(1).optional(),
  modelId: idSchema.optional(),
  personalityVersion: z.string().trim().min(1).optional(),
});

const profileSchema = z.object({
  id: idSchema,
  modelId: idSchema,
  name: z.string().trim().min(1).optional(),
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

function validateUniqueIds(registry: RegistryConfig): Result<void> {
  const checks = [
    ensureUniqueIds('Provider', registry.providers),
    ensureUniqueIds('Model', registry.models),
    ensureUniqueIds('Runtime', registry.runtimes),
    ensureUniqueIds('Agent', registry.agents),
    ensureUniqueIds('Profile', registry.profiles),
  ];
  for (const check of checks) if (!check.success) return check;
  return success(undefined);
}

function validateModelProviderRefs(registry: RegistryConfig): Result<void> {
  for (const model of registry.models) {
    const provider = findById(registry.providers, model.providerId);
    if (!provider)
      return failure(`Model 引用了未知 Provider: ${model.providerId}`);
  }
  for (const runtime of registry.runtimes) {
    const modelRes = validateModelReference(
      registry,
      runtime.modelId,
      `Runtime ${runtime.id}`,
    );
    if (!modelRes.success) return modelRes;
  }
  return success(undefined);
}

function validateCrossReferences(registry: RegistryConfig): Result<void> {
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
  }
  for (const profile of registry.profiles) {
    const modelRes = validateModelReference(
      registry,
      profile.modelId,
      `Profile ${profile.id}`,
    );
    if (!modelRes.success) return modelRes;
    if (!modelRes.data) return failure(`Profile 缺少 Model: ${profile.id}`);
    const maxTokens = profile.parameters?.maxTokens;
    if (
      maxTokens !== undefined &&
      modelRes.data.maxOutputTokens !== undefined &&
      maxTokens > modelRes.data.maxOutputTokens
    ) {
      return failure(`Profile ${profile.id} maxTokens 超过模型输出上限`);
    }
  }
  return success(undefined);
}

function validateRegistryReferences(
  registry: RegistryConfig,
): Result<RegistryConfig> {
  const uniqueRes = validateUniqueIds(registry);
  if (!uniqueRes.success) return uniqueRes;
  const providerRes = validateModelProviderRefs(registry);
  if (!providerRes.success) return providerRes;
  const crossRes = validateCrossReferences(registry);
  if (!crossRes.success) return crossRes;
  return success(registry);
}

export function parseRegistryConfig(value: unknown): Result<RegistryConfig> {
  const migrated = migrateLegacyRegistryConfig(value);
  const parsed = registrySchema.safeParse(migrated || value);
  if (!parsed.success) {
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
