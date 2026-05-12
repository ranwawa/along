// biome-ignore-all lint/style/noJsxLiterals: settings table uses compact inline labels.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: table rendering is kept together for readability.

import { Input, Select } from '../components/ui/input';
import type { ProviderConfig, ProviderKind, RegistryConfig } from '../types';
import {
  DeleteButton,
  EmptyRows,
  optional,
  Section,
} from './registryTableParts';

export function ProviderRows({
  registry,
  disabled,
  onAdd,
  onUpdate,
  onRemove,
}: {
  registry: RegistryConfig;
  disabled: boolean;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<ProviderConfig>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Section
      title="Providers"
      count={registry.providers.length}
      disabled={disabled}
      onAdd={onAdd}
    >
      <div className="hidden md:grid grid-cols-[150px_170px_minmax(0,1fr)_190px_84px] gap-3 px-4 py-2 border-b border-border-color text-xs font-semibold text-text-muted">
        <span>ID</span>
        <span>Kind</span>
        <span>Base URL</span>
        <span>Default Credential</span>
        <span />
      </div>
      <div className="divide-y divide-white/5">
        {registry.providers.length === 0 && <EmptyRows label="暂无 Provider" />}
        {registry.providers.map((provider) => (
          <div
            key={provider.id}
            className="grid grid-cols-1 md:grid-cols-[150px_170px_minmax(0,1fr)_190px_84px] gap-3 p-4 items-center"
          >
            <Input
              type="text"
              value={provider.id}
              onChange={(event) =>
                onUpdate(provider.id, { id: event.target.value })
              }
            />
            <Select
              value={provider.kind}
              onChange={(event) =>
                onUpdate(provider.id, {
                  kind: event.target.value as ProviderKind,
                })
              }
            >
              <option value="openai-compatible">openai-compatible</option>
              <option value="anthropic">anthropic</option>
              <option value="custom">custom</option>
            </Select>
            <Input
              type="text"
              value={provider.baseUrl || ''}
              onChange={(event) =>
                onUpdate(provider.id, { baseUrl: optional(event.target.value) })
              }
              placeholder="https://api.openai.com/v1"
            />
            <Select
              value={provider.defaultCredentialId || ''}
              onChange={(event) =>
                onUpdate(provider.id, {
                  defaultCredentialId: optional(event.target.value),
                })
              }
            >
              <option value="">未设置</option>
              {registry.credentials
                .filter((credential) => credential.providerId === provider.id)
                .map((credential) => (
                  <option key={credential.id} value={credential.id}>
                    {credential.id}
                  </option>
                ))}
            </Select>
            <DeleteButton
              disabled={disabled}
              onClick={() => onRemove(provider.id)}
            />
          </div>
        ))}
      </div>
    </Section>
  );
}
