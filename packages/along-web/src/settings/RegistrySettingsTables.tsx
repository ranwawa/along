// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: registry sections are clearer in one composition.
import type {
  AgentConfig,
  CredentialConfig,
  ModelConfig,
  ProviderConfig,
  RegistryConfig,
  RuntimeConfig,
} from '../types';
import { AgentRegistryRows } from './AgentRegistryRows';
import { CredentialRows } from './CredentialRows';
import { ModelRows } from './ModelRows';
import { ProviderRows } from './ProviderRows';
import { RuntimeRows } from './RuntimeRows';

interface RegistryActions {
  addProvider: () => void;
  updateProvider: (id: string, patch: Partial<ProviderConfig>) => void;
  removeProvider: (id: string) => void;
  addCredential: () => void;
  updateCredential: (id: string, patch: Partial<CredentialConfig>) => void;
  removeCredential: (id: string) => void;
  addModel: () => void;
  updateModel: (id: string, patch: Partial<ModelConfig>) => void;
  removeModel: (id: string) => void;
  addRuntime: () => void;
  updateRuntime: (id: string, patch: Partial<RuntimeConfig>) => void;
  removeRuntime: (id: string) => void;
  addAgent: () => void;
  updateAgent: (id: string, patch: Partial<AgentConfig>) => void;
  removeAgent: (id: string) => void;
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
      <CredentialRows
        registry={registry}
        disabled={disabled}
        onAdd={actions.addCredential}
        onUpdate={actions.updateCredential}
        onRemove={actions.removeCredential}
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
