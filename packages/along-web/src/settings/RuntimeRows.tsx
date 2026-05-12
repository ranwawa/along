// biome-ignore-all lint/style/noJsxLiterals: settings table uses compact inline labels.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: table rendering is kept together for readability.

import { Input, Select } from '../components/ui/input';
import type { RegistryConfig, RuntimeConfig } from '../types';
import {
  DeleteButton,
  EmptyRows,
  optional,
  Section,
} from './registryTableParts';

export function RuntimeRows({
  registry,
  disabled,
  onAdd,
  onUpdate,
  onRemove,
}: {
  registry: RegistryConfig;
  disabled: boolean;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<RuntimeConfig>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Section
      title="Runtimes"
      count={registry.runtimes.length}
      disabled={disabled}
      onAdd={onAdd}
    >
      <div className="hidden md:grid grid-cols-[150px_120px_minmax(0,1fr)_190px_84px] gap-3 px-4 py-2 border-b border-border-color text-xs font-semibold text-text-muted">
        <span>ID</span>
        <span>Kind</span>
        <span>Model</span>
        <span>Credential</span>
        <span />
      </div>
      <div className="divide-y divide-white/5">
        {registry.runtimes.length === 0 && <EmptyRows label="暂无 Runtime" />}
        {registry.runtimes.map((runtime) => {
          const selectedModel = registry.models.find(
            (model) => model.id === runtime.modelId,
          );
          return (
            <div
              key={runtime.id}
              className="grid grid-cols-1 md:grid-cols-[150px_120px_minmax(0,1fr)_190px_84px] gap-3 p-4 items-center"
            >
              <Input
                type="text"
                value={runtime.id}
                onChange={(event) =>
                  onUpdate(runtime.id, { id: event.target.value })
                }
              />
              <Input
                type="text"
                value={runtime.kind}
                readOnly
                className="text-text-muted"
              />
              <Select
                value={runtime.modelId || ''}
                onChange={(event) =>
                  onUpdate(runtime.id, {
                    modelId: optional(event.target.value),
                  })
                }
              >
                <option value="">未设置</option>
                {registry.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id}
                  </option>
                ))}
              </Select>
              <Select
                value={runtime.credentialId || ''}
                onChange={(event) =>
                  onUpdate(runtime.id, {
                    credentialId: optional(event.target.value),
                  })
                }
              >
                <option value="">使用模型/Provider 默认</option>
                {registry.credentials
                  .filter(
                    (credential) =>
                      !selectedModel ||
                      credential.providerId === selectedModel.providerId,
                  )
                  .map((credential) => (
                    <option key={credential.id} value={credential.id}>
                      {credential.id}
                    </option>
                  ))}
              </Select>
              <DeleteButton
                disabled={disabled}
                onClick={() => onRemove(runtime.id)}
              />
            </div>
          );
        })}
      </div>
    </Section>
  );
}
