import type { Dispatch, SetStateAction } from 'react';
import type {
  AgentConfig,
  CredentialConfig,
  ModelConfig,
  ProviderConfig,
  RegistryConfig,
  RuntimeConfig,
} from '../types';
import type { SettingsState } from './useSettingsController';

type SetSettingsState = Dispatch<SetStateAction<SettingsState>>;

const emptyRegistry: RegistryConfig = {
  providers: [],
  credentials: [],
  models: [],
  runtimes: [],
  agents: [],
  profiles: [],
};

function nextId(prefix: string, existing: string[]) {
  let index = 1;
  let id = `${prefix}-${index}`;
  const ids = new Set(existing);
  while (ids.has(id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

function getRegistry(state: SettingsState): RegistryConfig {
  return state.registry || emptyRegistry;
}

function createProvider(id: string): ProviderConfig {
  return { id, kind: 'openai-compatible', baseUrl: '' };
}

function createCredential(
  id: string,
  registry: RegistryConfig,
): CredentialConfig {
  return { id, providerId: registry.providers[0]?.id || '', token: '' };
}

function createModel(id: string, registry: RegistryConfig): ModelConfig {
  return { id, providerId: registry.providers[0]?.id || '', model: '' };
}

function createRuntime(id: string, registry: RegistryConfig): RuntimeConfig {
  return { id, kind: 'codex', modelId: registry.models[0]?.id || undefined };
}

function createAgent(id: string, registry: RegistryConfig): AgentConfig {
  return { id, runtimeId: registry.runtimes[0]?.id || 'codex' };
}

function updateList<T extends { id: string }>(
  items: T[],
  id: string,
  patch: Partial<T>,
) {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

function updateRegistry(
  setState: SetSettingsState,
  updater: (registry: RegistryConfig) => RegistryConfig,
) {
  setState((previous) => {
    const registry = getRegistry(previous);
    return { ...previous, registry: updater(registry), savedAt: null };
  });
}

function addItem<T extends { id: string }>(
  items: T[],
  prefix: string,
  create: (id: string) => T,
) {
  const id = nextId(
    prefix,
    items.map((item) => item.id),
  );
  return [...items, create(id)];
}

function removeItem<T extends { id: string }>(items: T[], id: string) {
  return items.filter((item) => item.id !== id);
}

function providerActions(setState: SetSettingsState) {
  return {
    addProvider: () =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        providers: addItem(registry.providers, 'provider', createProvider),
      })),
    updateProvider: (id: string, patch: Partial<ProviderConfig>) =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        providers: updateList(registry.providers, id, patch),
      })),
    removeProvider: (id: string) =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        providers: removeItem(registry.providers, id),
      })),
  };
}

function credentialActions(setState: SetSettingsState) {
  return {
    addCredential: () =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        credentials: addItem(registry.credentials, 'credential', (id) =>
          createCredential(id, registry),
        ),
      })),
    updateCredential: (id: string, patch: Partial<CredentialConfig>) =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        credentials: updateList(registry.credentials, id, patch),
      })),
    removeCredential: (id: string) =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        credentials: removeItem(registry.credentials, id),
      })),
  };
}

function modelActions(setState: SetSettingsState) {
  return {
    addModel: () =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        models: addItem(registry.models, 'model', (id) =>
          createModel(id, registry),
        ),
      })),
    updateModel: (id: string, patch: Partial<ModelConfig>) =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        models: updateList(registry.models, id, patch),
      })),
    removeModel: (id: string) =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        models: removeItem(registry.models, id),
      })),
  };
}

function runtimeActions(setState: SetSettingsState) {
  return {
    addRuntime: () =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        runtimes: addItem(registry.runtimes, 'runtime', (id) =>
          createRuntime(id, registry),
        ),
      })),
    updateRuntime: (id: string, patch: Partial<RuntimeConfig>) =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        runtimes: updateList(registry.runtimes, id, patch),
      })),
    removeRuntime: (id: string) =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        runtimes: removeItem(registry.runtimes, id),
      })),
  };
}

function agentActions(setState: SetSettingsState) {
  return {
    addAgent: () =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        agents: addItem(registry.agents, 'agent', (id) =>
          createAgent(id, registry),
        ),
      })),
    updateAgent: (id: string, patch: Partial<AgentConfig>) =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        agents: updateList(registry.agents, id, patch),
      })),
    removeAgent: (id: string) =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        agents: removeItem(registry.agents, id),
      })),
  };
}

export function useRegistryActions(setState: SetSettingsState) {
  return {
    ...providerActions(setState),
    ...credentialActions(setState),
    ...modelActions(setState),
    ...runtimeActions(setState),
    ...agentActions(setState),
  };
}
