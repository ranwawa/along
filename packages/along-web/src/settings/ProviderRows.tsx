import { Input, Select } from '../components/ui/input';
import type { ProviderConfig, ProviderKind, RegistryConfig } from '../types';
import {
  DeleteButton,
  EmptyRows,
  optional,
  Section,
} from './registryTableParts';

const LABELS = {
  noProvider: '暂无 Provider',
  openaiCompatible: 'openai-compatible',
  anthropic: 'anthropic',
  custom: 'custom',
} as const;

function ProviderRow({
  provider,
  disabled,
  onUpdate,
  onRemove,
}: {
  provider: ProviderConfig;
  disabled: boolean;
  onUpdate: (id: string, patch: Partial<ProviderConfig>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[150px_170px_minmax(0,1fr)_84px] gap-3 p-4 items-center">
      <Input
        type="text"
        value={provider.id}
        onChange={(event) => onUpdate(provider.id, { id: event.target.value })}
      />
      <Select
        value={provider.kind}
        onChange={(event) =>
          onUpdate(provider.id, { kind: event.target.value as ProviderKind })
        }
      >
        <option value="openai-compatible">{LABELS.openaiCompatible}</option>
        <option value="anthropic">{LABELS.anthropic}</option>
        <option value="custom">{LABELS.custom}</option>
      </Select>
      <Input
        type="text"
        value={provider.baseUrl || ''}
        onChange={(event) =>
          onUpdate(provider.id, { baseUrl: optional(event.target.value) })
        }
        placeholder="https://api.openai.com/v1"
      />
      <DeleteButton disabled={disabled} onClick={() => onRemove(provider.id)} />
    </div>
  );
}

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
      <div className="hidden md:grid grid-cols-[150px_170px_minmax(0,1fr)_84px] gap-3 px-4 py-2 border-b border-border-color text-xs font-semibold text-text-muted">
        <span>ID</span>
        <span>Kind</span>
        <span>Base URL</span>
        <span />
      </div>
      <div className="divide-y divide-white/5">
        {registry.providers.length === 0 && (
          <EmptyRows label={LABELS.noProvider} />
        )}
        {registry.providers.map((provider) => (
          <ProviderRow
            key={provider.id}
            provider={provider}
            disabled={disabled}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))}
      </div>
    </Section>
  );
}
