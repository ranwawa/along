import type {
  AgentConfig,
  CredentialConfig,
  ModelConfig,
  ProfileConfig,
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
  credentialId?: string;
  modelName: string;
}): string {
  const existingId = findModelIdByName(input.models, input.modelName);
  if (existingId) return existingId;

  const id = getUniqueId(input.modelName, input.usedModelIds);
  input.models.push({
    id,
    providerId: input.providerId,
    model: input.modelName,
    credentialId: input.credentialId,
  });
  return id;
}

function migrateLegacyProviderEntries(input: {
  legacyProviders: UnknownRecord;
  providers: ProviderConfig[];
  credentials: CredentialConfig[];
  models: ModelConfig[];
  usedProviderIds: Set<string>;
  usedCredentialIds: Set<string>;
  usedModelIds: Set<string>;
}): string | undefined {
  let fallbackProviderId: string | undefined;

  for (const [rawProviderId, rawProvider] of Object.entries(
    input.legacyProviders,
  )) {
    if (!isRecord(rawProvider)) continue;

    const providerId = getUniqueId(rawProviderId, input.usedProviderIds);
    const token = getString(rawProvider.token);
    const credentialId = token
      ? getUniqueId(`${providerId}-token`, input.usedCredentialIds)
      : undefined;

    input.providers.push({
      id: providerId,
      kind: 'openai-compatible',
      name: getString(rawProvider.name),
      baseUrl: getString(rawProvider.baseUrl),
      defaultCredentialId: credentialId,
    });

    if (credentialId && token) {
      input.credentials.push({ id: credentialId, providerId, token });
    }

    for (const modelName of getStringArray(rawProvider.models)) {
      addModel({
        models: input.models,
        usedModelIds: input.usedModelIds,
        providerId,
        credentialId,
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
          modelName,
        })
      : undefined;

    input.agents.push({ id: agentId, runtimeId: 'codex', modelId });
  }
}

export function migrateLegacyRegistryConfig(
  value: unknown,
): RegistryConfig | null {
  if (!isRecord(value) || !isRecord(value.providers)) return null;

  const providers: ProviderConfig[] = [];
  const credentials: CredentialConfig[] = [];
  const models: ModelConfig[] = [];
  const runtimes: RuntimeConfig[] = [{ id: 'codex', kind: 'codex' }];
  const agents: AgentConfig[] = [];
  const profiles: ProfileConfig[] = [];
  const usedProviderIds = new Set<string>();
  const usedCredentialIds = new Set<string>();
  const usedModelIds = new Set<string>();

  let fallbackProviderId = migrateLegacyProviderEntries({
    legacyProviders: value.providers,
    providers,
    credentials,
    models,
    usedProviderIds,
    usedCredentialIds,
    usedModelIds,
  });

  if (!fallbackProviderId && isRecord(value.taskAgents)) {
    fallbackProviderId = getUniqueId('codex', usedProviderIds);
    providers.push({ id: fallbackProviderId, kind: 'custom', name: 'Codex' });
  }

  if (fallbackProviderId && isRecord(value.taskAgents)) {
    migrateLegacyTaskAgents({
      legacyTaskAgents: value.taskAgents,
      fallbackProviderId,
      models,
      agents,
      usedModelIds,
    });
  }

  return { providers, credentials, models, runtimes, agents, profiles };
}
