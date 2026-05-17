import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
import type { ModelConfig, RegistryConfig } from '../types';
import {
  DeleteButton,
  EmptyRows,
  optional,
  Section,
} from './registryTableParts';
import { getKey } from './stableKey';

const LABELS = {
  noModel: '暂无 Model',
  selectProvider: '选择 Provider',
  tokenPlaceholder: '直接保存 token',
  hideToken: '隐藏 token 明文',
  showToken: '查看 token 明文',
  hide: '隐藏',
  show: '查看',
  colId: 'ID',
  colProvider: 'Provider',
  colModelName: 'Model Name',
  colToken: 'Token',
  colTokenEnv: 'Token Env',
} as const;

function TokenInput({
  model,
  index,
  visible,
  disabled,
  onToggleVisible,
  onUpdate,
}: {
  model: ModelConfig;
  index: number;
  visible: boolean;
  disabled: boolean;
  onToggleVisible: () => void;
  onUpdate: (index: number, patch: Partial<ModelConfig>) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Input
        type={visible ? 'text' : 'password'}
        value={model.token || ''}
        onChange={(event) =>
          onUpdate(index, { token: optional(event.target.value) })
        }
        placeholder={LABELS.tokenPlaceholder}
        className="flex-1"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={onToggleVisible}
        aria-pressed={visible}
        title={visible ? LABELS.hideToken : LABELS.showToken}
      >
        {visible ? (
          <EyeOff aria-hidden="true" className="h-4 w-4" />
        ) : (
          <Eye aria-hidden="true" className="h-4 w-4" />
        )}
        <span>{visible ? LABELS.hide : LABELS.show}</span>
      </Button>
    </div>
  );
}

function ProviderSelect({
  registry,
  value,
  onChange,
}: {
  registry: RegistryConfig;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{LABELS.selectProvider}</option>
      {registry.providers.map((provider) => (
        <option key={provider.id} value={provider.id}>
          {provider.id}
        </option>
      ))}
    </Select>
  );
}

function ModelRow({
  model,
  index,
  registry,
  visible,
  disabled,
  onToggleVisible,
  onUpdate,
  onRemove,
}: {
  model: ModelConfig;
  index: number;
  registry: RegistryConfig;
  visible: boolean;
  disabled: boolean;
  onToggleVisible: () => void;
  onUpdate: (index: number, patch: Partial<ModelConfig>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[150px_170px_minmax(0,1fr)_minmax(0,1fr)_180px_84px] gap-3 p-4 items-center">
      <Input
        type="text"
        value={model.id}
        onChange={(event) => onUpdate(index, { id: event.target.value })}
      />
      <ProviderSelect
        registry={registry}
        value={model.providerId}
        onChange={(providerId) => onUpdate(index, { providerId })}
      />
      <Input
        type="text"
        value={model.model}
        onChange={(event) => onUpdate(index, { model: event.target.value })}
        placeholder="gpt-5.5"
      />
      <TokenInput
        model={model}
        index={index}
        visible={visible}
        disabled={disabled}
        onToggleVisible={onToggleVisible}
        onUpdate={onUpdate}
      />
      <Input
        type="text"
        value={model.tokenEnv || ''}
        onChange={(event) =>
          onUpdate(index, { tokenEnv: optional(event.target.value) })
        }
        placeholder="OPENAI_API_KEY"
      />
      <DeleteButton disabled={disabled} onClick={() => onRemove(index)} />
    </div>
  );
}

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
  onUpdate: (index: number, patch: Partial<ModelConfig>) => void;
  onRemove: (index: number) => void;
}) {
  const [visibleTokenIds, setVisibleTokenIds] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleTokenVisible = (id: string) => {
    setVisibleTokenIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Section
      title="Models"
      count={registry.models.length}
      disabled={disabled}
      onAdd={onAdd}
    >
      <div className="hidden md:grid grid-cols-[150px_170px_minmax(0,1fr)_minmax(0,1fr)_180px_84px] gap-3 px-4 py-2 border-b border-border-color text-xs font-semibold text-text-muted">
        <span>{LABELS.colId}</span>
        <span>{LABELS.colProvider}</span>
        <span>{LABELS.colModelName}</span>
        <span>{LABELS.colToken}</span>
        <span>{LABELS.colTokenEnv}</span>
        <span />
      </div>
      <div className="divide-y divide-white/5">
        {registry.models.length === 0 && <EmptyRows label={LABELS.noModel} />}
        {registry.models.map((model, index) => (
          <ModelRow
            key={getKey(model)}
            model={model}
            index={index}
            registry={registry}
            visible={visibleTokenIds.has(model.id)}
            disabled={disabled}
            onToggleVisible={() => toggleTokenVisible(model.id)}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))}
      </div>
    </Section>
  );
}
