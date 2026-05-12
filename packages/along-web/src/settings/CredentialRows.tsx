// biome-ignore-all lint/style/noJsxLiterals: settings table uses compact inline labels.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: table rendering is kept together for readability.

import { Input, Select } from '../components/ui/input';
import type { CredentialConfig, RegistryConfig } from '../types';
import {
  DeleteButton,
  EmptyRows,
  optional,
  Section,
} from './registryTableParts';

export function CredentialRows({
  registry,
  disabled,
  onAdd,
  onUpdate,
  onRemove,
}: {
  registry: RegistryConfig;
  disabled: boolean;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<CredentialConfig>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Section
      title="Credentials"
      count={registry.credentials.length}
      disabled={disabled}
      onAdd={onAdd}
    >
      <div className="hidden md:grid grid-cols-[150px_170px_minmax(0,1fr)_180px_84px] gap-3 px-4 py-2 border-b border-border-color text-xs font-semibold text-text-muted">
        <span>ID</span>
        <span>Provider</span>
        <span>Token</span>
        <span>Token Env</span>
        <span />
      </div>
      <div className="divide-y divide-white/5">
        {registry.credentials.length === 0 && (
          <EmptyRows label="暂无 Credential" />
        )}
        {registry.credentials.map((credential) => (
          <div
            key={credential.id}
            className="grid grid-cols-1 md:grid-cols-[150px_170px_minmax(0,1fr)_180px_84px] gap-3 p-4 items-center"
          >
            <Input
              type="text"
              value={credential.id}
              onChange={(event) =>
                onUpdate(credential.id, { id: event.target.value })
              }
            />
            <Select
              value={credential.providerId}
              onChange={(event) =>
                onUpdate(credential.id, { providerId: event.target.value })
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
              type="password"
              value={credential.token || ''}
              onChange={(event) =>
                onUpdate(credential.id, { token: optional(event.target.value) })
              }
              placeholder="直接保存 token"
            />
            <Input
              type="text"
              value={credential.tokenEnv || ''}
              onChange={(event) =>
                onUpdate(credential.id, {
                  tokenEnv: optional(event.target.value),
                })
              }
              placeholder="OPENAI_API_KEY"
            />
            <DeleteButton
              disabled={disabled}
              onClick={() => onRemove(credential.id)}
            />
          </div>
        ))}
      </div>
    </Section>
  );
}
