import type {
  AgentConfig,
  ModelConfig,
  ProviderConfig,
  RegistryConfig,
  RuntimeConfig,
} from './ai-registry-config';
import {
  getString,
  isRecord,
  migrateRegistryArrayConfig,
} from './ai-registry-legacy-config-providers';

type UnknownRecord = Record<string, unknown>;

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => getString(item))
        .filter((item): item is string => Boolean(item))
    : [];
}

function getUniqueId(baseId: string, usedIds: Set<string>): string {
  let id = baseId;
  let index = 2;
  while (usedIds.has(id)) {
    id = `${baseId}-${index}`;
    index += 1;
  }
  usedIds.add(id);
  return id;
}

function findModelIdByName(
  models: ModelConfig[],
  modelName: string,
): string | undefined {
  return models.find((model) => model.model === modelName)?.id;
}

function addModel(input: {
  models: ModelConfig[];
  usedModelIds: Set<string>;
  providerId: string;
  token?: string;
  tokenEnv?: string;
  modelName: string;
}): string {
  const existingId = findModelIdByName(input.models, input.modelName);
  if (existingId) return existingId;

  const id = getUniqueId(input.modelName, input.usedModelIds);
  input.models.push({
    id,
    providerId: input.providerId,
    model: input.modelName,
    token: input.token,
    tokenEnv: input.tokenEnv,
  });
  return id;
}

function migrateLegacyProviderEntries(input: {
  legacyProviders: UnknownRecord;
  providers: ProviderConfig[];
  models: ModelConfig[];
  providerTokens: Map<string, string>;
  usedProviderIds: Set<string>;
  usedModelIds: Set<string>;
}): string | undefined {
  let fallbackProviderId: string | undefined;

  for (const [rawProviderId, rawProvider] of Object.entries(
    input.legacyProviders,
  )) {
    if (!isRecord(rawProvider)) continue;

    const providerId = getUniqueId(rawProviderId, input.usedProviderIds);
    const token = getString(rawProvider.token);
    if (token) input.providerTokens.set(providerId, token);

    input.providers.push({
      id: providerId,
      kind: 'openai-compatible',
      name: getString(rawProvider.name),
      baseUrl: getString(rawProvider.baseUrl),
    });

    for (const modelName of getStringArray(rawProvider.models)) {
      addModel({
        models: input.models,
        usedModelIds: input.usedModelIds,
        providerId,
        token,
        modelName,
      });
    }

    fallbackProviderId ||= providerId;
  }

  return fallbackProviderId;
}

function migrateLegacyTaskAgents(input: {
  legacyTaskAgents: UnknownRecord;
  fallbackProviderId: string;
  models: ModelConfig[];
  agents: AgentConfig[];
  providerTokens: Map<string, string>;
  usedModelIds: Set<string>;
}): void {
  for (const [agentId, rawAgent] of Object.entries(input.legacyTaskAgents)) {
    if (!isRecord(rawAgent)) continue;
    if (getString(rawAgent.editor) !== 'codex') continue;

    const modelName = getString(rawAgent.model);
    const modelId = modelName
      ? addModel({
          models: input.models,
          usedModelIds: input.usedModelIds,
          providerId: input.fallbackProviderId,
          token: input.providerTokens.get(input.fallbackProviderId),
          modelName,
        })
      : undefined;

    input.agents.push({ id: agentId, runtimeId: 'codex', modelId });
  }
}

export function migrateLegacyRegistryConfig(
  value: unknown,
): RegistryConfig | null {
  if (!isRecord(value)) return null;

  const arrayRegistry = migrateRegistryArrayConfig(value);
  if (arrayRegistry) return arrayRegistry;

  if (!isRecord(value.providers)) return null;

  const providers: ProviderConfig[] = [];
  const models: ModelConfig[] = [];
  const runtimes: RuntimeConfig[] = [{ id: 'codex', kind: 'codex' }];
  const agents: AgentConfig[] = [];
  const providerTokens = new Map<string, string>();
  const usedProviderIds = new Set<string>();
  const usedModelIds = new Set<string>();

  const fallbackProviderId = migrateLegacyProviderEntries({
    legacyProviders: value.providers,
    providers,
    models,
    providerTokens,
    usedProviderIds,
    usedModelIds,
  });

  if (fallbackProviderId && isRecord(value.taskAgents)) {
    migrateLegacyTaskAgents({
      legacyTaskAgents: value.taskAgents,
      fallbackProviderId,
      models,
      agents,
      providerTokens,
      usedModelIds,
    });
  }

  return { providers, models, runtimes, agents, profiles: [] };
}
