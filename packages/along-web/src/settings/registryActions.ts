import type { Dispatch, SetStateAction } from 'react';
import type {
  AgentConfig,
  ModelConfig,
  ProviderConfig,
  RegistryConfig,
  RuntimeConfig,
} from '../types';
import { attachKey } from './stableKey';
import type { SettingsState } from './useSettingsController';

type SetSettingsState = Dispatch<SetStateAction<SettingsState>>;

const emptyRegistry: RegistryConfig = {
  providers: [],
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

function createModel(id: string, registry: RegistryConfig): ModelConfig {
  return { id, providerId: registry.providers[0]?.id || '', model: '' };
}

function createRuntime(id: string, registry: RegistryConfig): RuntimeConfig {
  return { id, kind: 'codex', modelId: registry.models[0]?.id || undefined };
}

function createAgent(id: string, registry: RegistryConfig): AgentConfig {
  return { id, runtimeId: registry.runtimes[0]?.id || 'codex' };
}

function updateListByIndex<T>(items: T[], index: number, patch: Partial<T>) {
  return items.map((item, i) => (i === index ? { ...item, ...patch } : item));
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
  return [...items, attachKey(create(id))];
}

function removeByIndex<T>(items: T[], index: number) {
  return items.filter((_, i) => i !== index);
}

function providerActions(setState: SetSettingsState) {
  return {
    addProvider: () =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        providers: addItem(registry.providers, 'provider', createProvider),
      })),
    updateProvider: (index: number, patch: Partial<ProviderConfig>) =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        providers: updateListByIndex(registry.providers, index, patch),
      })),
    removeProvider: (index: number) =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        providers: removeByIndex(registry.providers, index),
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
    updateModel: (index: number, patch: Partial<ModelConfig>) =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        models: updateListByIndex(registry.models, index, patch),
      })),
    removeModel: (index: number) =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        models: removeByIndex(registry.models, index),
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
    updateRuntime: (index: number, patch: Partial<RuntimeConfig>) =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        runtimes: updateListByIndex(registry.runtimes, index, patch),
      })),
    removeRuntime: (index: number) =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        runtimes: removeByIndex(registry.runtimes, index),
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
    updateAgent: (index: number, patch: Partial<AgentConfig>) =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        agents: updateListByIndex(registry.agents, index, patch),
      })),
    removeAgent: (index: number) =>
      updateRegistry(setState, (registry) => ({
        ...registry,
        agents: removeByIndex(registry.agents, index),
      })),
  };
}

export function useRegistryActions(setState: SetSettingsState) {
  return {
    ...providerActions(setState),
    ...modelActions(setState),
    ...runtimeActions(setState),
    ...agentActions(setState),
  };
}
