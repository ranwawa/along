import type {
  AgentConfig,
  ModelConfig,
  ProviderConfig,
  RegistryConfig,
  RuntimeConfig,
} from '../types';
import { AgentRegistryRows } from './AgentRegistryRows';
import { ModelRows } from './ModelRows';
import { ProviderRows } from './ProviderRows';
import { RuntimeRows } from './RuntimeRows';

interface RegistryActions {
  addProvider: () => void;
  updateProvider: (index: number, patch: Partial<ProviderConfig>) => void;
  removeProvider: (index: number) => void;
  addModel: () => void;
  updateModel: (index: number, patch: Partial<ModelConfig>) => void;
  removeModel: (index: number) => void;
  addRuntime: () => void;
  updateRuntime: (index: number, patch: Partial<RuntimeConfig>) => void;
  removeRuntime: (index: number) => void;
  addAgent: () => void;
  updateAgent: (index: number, patch: Partial<AgentConfig>) => void;
  removeAgent: (index: number) => void;
}

export function RegistrySettingsTables({
  registry,
  loading,
  saving,
  actions,
}: {
  registry: RegistryConfig;
  loading: boolean;
  saving: boolean;
  actions: RegistryActions;
}) {
  const disabled = loading || saving;
  return (
    <>
      <ProviderRows
        registry={registry}
        disabled={disabled}
        onAdd={actions.addProvider}
        onUpdate={actions.updateProvider}
        onRemove={actions.removeProvider}
      />
      <ModelRows
        registry={registry}
        disabled={disabled}
        onAdd={actions.addModel}
        onUpdate={actions.updateModel}
        onRemove={actions.removeModel}
      />
      <RuntimeRows
        registry={registry}
        disabled={disabled}
        onAdd={actions.addRuntime}
        onUpdate={actions.updateRuntime}
        onRemove={actions.removeRuntime}
      />
      <AgentRegistryRows
        registry={registry}
        disabled={disabled}
        onAdd={actions.addAgent}
        onUpdate={actions.updateAgent}
        onRemove={actions.removeAgent}
      />
    </>
  );
}
