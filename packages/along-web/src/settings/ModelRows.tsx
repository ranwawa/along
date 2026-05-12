// biome-ignore-all lint/style/noJsxLiterals: settings table uses compact inline labels.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: table rendering is kept together for readability.

import { Input, Select } from '../components/ui/input';
import type { ModelConfig, RegistryConfig } from '../types';
import {
  DeleteButton,
  EmptyRows,
  optional,
  Section,
} from './registryTableParts';

export function ModelRows({
  registry,
  disabled,
  onAdd,
  onUpdate,
  onRemove,
}: {
  registry: RegistryConfig;
  disabled: boolean;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<ModelConfig>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Section
      title="Models"
      count={registry.models.length}
      disabled={disabled}
      onAdd={onAdd}
    >
      <div className="hidden md:grid grid-cols-[150px_170px_minmax(0,1fr)_190px_84px] gap-3 px-4 py-2 border-b border-border-color text-xs font-semibold text-text-muted">
        <span>ID</span>
        <span>Provider</span>
        <span>Model Name</span>
        <span>Credential</span>
        <span />
      </div>
      <div className="divide-y divide-white/5">
        {registry.models.length === 0 && <EmptyRows label="暂无 Model" />}
        {registry.models.map((model) => (
          <div
            key={model.id}
            className="grid grid-cols-1 md:grid-cols-[150px_170px_minmax(0,1fr)_190px_84px] gap-3 p-4 items-center"
          >
            <Input
              type="text"
              value={model.id}
              onChange={(event) =>
                onUpdate(model.id, { id: event.target.value })
              }
            />
            <Select
              value={model.providerId}
              onChange={(event) =>
                onUpdate(model.id, { providerId: event.target.value })
              }
            >
              <option value="">选择 Provider</option>
              {registry.providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.id}
                </option>
              ))}
            </Select>
            <Input
              type="text"
              value={model.model}
              onChange={(event) =>
                onUpdate(model.id, { model: event.target.value })
              }
              placeholder="gpt-5.5"
            />
            <Select
              value={model.credentialId || ''}
              onChange={(event) =>
                onUpdate(model.id, {
                  credentialId: optional(event.target.value),
                })
              }
            >
              <option value="">使用 Provider 默认</option>
              {registry.credentials
                .filter(
                  (credential) => credential.providerId === model.providerId,
                )
                .map((credential) => (
                  <option key={credential.id} value={credential.id}>
                    {credential.id}
                  </option>
                ))}
            </Select>
            <DeleteButton
              disabled={disabled}
              onClick={() => onRemove(model.id)}
            />
          </div>
        ))}
      </div>
    </Section>
  );
}
