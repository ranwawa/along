import type {
  AgentConfig,
  ModelConfig,
  ProviderConfig,
  RegistryConfig,
  RuntimeConfig,
} from './config';

type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
    (Array.isArray(value.providers) &&
      value.providers.some(
        (provider: unknown) =>
          isRecord(provider) && getString(provider.defaultCredentialId),
      )) ||
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

export const LEGACY_AGENT_ID_MAP: Record<string, string> = {
  planner: 'planning',
  implementer: 'exec',
};

function migrateRegistryArrayAgents(items: unknown): AgentConfig[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter(isRecord)
    .map((agent) => {
      const rawId = getString(agent.id) || '';
      return {
        id: LEGACY_AGENT_ID_MAP[rawId] || rawId,
        runtimeId: getString(agent.runtimeId) || '',
        name: getString(agent.name),
        modelId: getString(agent.modelId),
        personalityVersion: getString(agent.personalityVersion),
      };
    })
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
                ? (profile.parameters.outputFormat as 'json' | 'text')
                : undefined,
          }
        : undefined,
    }))
    .filter((profile) => profile.id && profile.modelId && profile.systemPrompt);
}

export function migrateRegistryArrayConfig(
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
