// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: legacy compatibility keeps shape conversions in one file.
import type {
  AgentConfig,
  ModelConfig,
  ProviderConfig,
  RegistryConfig,
  RuntimeConfig,
} from './ai-registry-config';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

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

function migrateRegistryArrayConfig(
  value: UnknownRecord,
): RegistryConfig | null {
  if (!Array.isArray(value.providers) || !Array.isArray(value.models)) {
    return null;
  }
  if (!hasLegacyCredentialFields(value)) return null;

  const credentialById = collectLegacyCredentials(value.credentials);
  const providerDefaults = new Map<string, string>();
  return {
    providers: migrateRegistryArrayProviders(value.providers, providerDefaults),
    models: migrateRegistryArrayModels(
      value.models,
      credentialById,
      providerDefaults,
    ),
    runtimes: migrateRegistryArrayRuntimes(value.runtimes),
    agents: migrateRegistryArrayAgents(value.agents),
    profiles: migrateRegistryArrayProfiles(value.profiles),
  };
}

function hasCredentialReference(items: unknown): boolean {
  return (
    Array.isArray(items) &&
    items.some((item) => isRecord(item) && getString(item.credentialId))
  );
}

function hasLegacyCredentialFields(value: UnknownRecord): boolean {
  return (
    Array.isArray(value.credentials) ||
    value.providers.some(
      (provider) =>
        isRecord(provider) && getString(provider.defaultCredentialId),
    ) ||
    hasCredentialReference(value.models) ||
    hasCredentialReference(value.runtimes) ||
    hasCredentialReference(value.agents) ||
    hasCredentialReference(value.profiles)
  );
}

function collectLegacyCredentials(items: unknown): Map<string, UnknownRecord> {
  const credentialById = new Map<string, UnknownRecord>();
  if (!Array.isArray(items)) return credentialById;
  for (const credential of items) {
    if (!isRecord(credential)) continue;
    const id = getString(credential.id);
    if (id) credentialById.set(id, credential);
  }
  return credentialById;
}

function migrateRegistryArrayProviders(
  items: unknown[],
  providerDefaults: Map<string, string>,
): ProviderConfig[] {
  return items.filter(isRecord).flatMap((provider) => {
    const id = getString(provider.id);
    const kind = getString(provider.kind) as ProviderConfig['kind'] | undefined;
    if (!id || !kind) return [];
    const defaultCredentialId = getString(provider.defaultCredentialId);
    if (defaultCredentialId) providerDefaults.set(id, defaultCredentialId);
    return {
      id,
      kind,
      name: getString(provider.name),
      baseUrl: getString(provider.baseUrl),
    };
  });
}

function migrateRegistryArrayModels(
  items: unknown[],
  credentialById: Map<string, UnknownRecord>,
  providerDefaults: Map<string, string>,
): ModelConfig[] {
  return items.filter(isRecord).flatMap((model) => {
    const id = getString(model.id);
    const providerId = getString(model.providerId);
    const modelName = getString(model.model);
    if (!id || !providerId || !modelName) return [];
    const credentialId =
      getString(model.credentialId) || providerDefaults.get(providerId);
    const credential = credentialId
      ? credentialById.get(credentialId)
      : undefined;
    return {
      id,
      providerId,
      model: modelName,
      name: getString(model.name),
      token: getString(model.token) || getString(credential?.token),
      tokenEnv: getString(model.tokenEnv) || getString(credential?.tokenEnv),
      contextWindow:
        typeof model.contextWindow === 'number'
          ? model.contextWindow
          : undefined,
      maxOutputTokens:
        typeof model.maxOutputTokens === 'number'
          ? model.maxOutputTokens
          : undefined,
    };
  });
}

function migrateRegistryArrayRuntimes(items: unknown): RuntimeConfig[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter(isRecord)
    .map((runtime) => ({
      id: getString(runtime.id) || '',
      kind: 'codex' as const,
      name: getString(runtime.name),
      modelId: getString(runtime.modelId),
    }))
    .filter((runtime) => runtime.id);
}

function migrateRegistryArrayAgents(items: unknown): AgentConfig[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter(isRecord)
    .map((agent) => ({
      id: getString(agent.id) || '',
      runtimeId: getString(agent.runtimeId) || '',
      name: getString(agent.name),
      modelId: getString(agent.modelId),
      personalityVersion: getString(agent.personalityVersion),
    }))
    .filter((agent) => agent.id && agent.runtimeId);
}

function migrateRegistryArrayProfiles(
  items: unknown,
): RegistryConfig['profiles'] {
  if (!Array.isArray(items)) return [];
  return items
    .filter(isRecord)
    .map((profile) => ({
      id: getString(profile.id) || '',
      modelId: getString(profile.modelId) || '',
      name: getString(profile.name),
      systemPrompt: getString(profile.systemPrompt) || '',
      userTemplate:
        typeof profile.userTemplate === 'string'
          ? profile.userTemplate
          : undefined,
      parameters: isRecord(profile.parameters)
        ? {
            temperature:
              typeof profile.parameters.temperature === 'number'
                ? profile.parameters.temperature
                : undefined,
            maxTokens:
              typeof profile.parameters.maxTokens === 'number'
                ? profile.parameters.maxTokens
                : undefined,
            outputFormat:
              profile.parameters.outputFormat === 'json' ||
              profile.parameters.outputFormat === 'text'
                ? profile.parameters.outputFormat
                : undefined,
          }
        : undefined,
    }))
    .filter((profile) => profile.id && profile.modelId && profile.systemPrompt);
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
