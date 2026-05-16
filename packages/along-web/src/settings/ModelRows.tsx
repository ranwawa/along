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

const LABELS = {
  noModel: '暂无 Model',
  selectProvider: '选择 Provider',
  tokenPlaceholder: '直接保存 token',
  hideToken: '隐藏 token 明文',
  showToken: '查看 token 明文',
  hide: '隐藏',
  show: '查看',
} as const;

function TokenInput({
  model,
  visible,
  disabled,
  onToggleVisible,
  onUpdate,
}: {
  model: ModelConfig;
  visible: boolean;
  disabled: boolean;
  onToggleVisible: () => void;
  onUpdate: (id: string, patch: Partial<ModelConfig>) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Input
        type={visible ? 'text' : 'password'}
        value={model.token || ''}
        onChange={(event) =>
          onUpdate(model.id, { token: optional(event.target.value) })
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

function ModelRow({
  model,
  registry,
  visible,
  disabled,
  onToggleVisible,
  onUpdate,
  onRemove,
}: {
  model: ModelConfig;
  registry: RegistryConfig;
  visible: boolean;
  disabled: boolean;
  onToggleVisible: () => void;
  onUpdate: (id: string, patch: Partial<ModelConfig>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[150px_170px_minmax(0,1fr)_minmax(0,1fr)_180px_84px] gap-3 p-4 items-center">
      <Input
        type="text"
        value={model.id}
        onChange={(event) => onUpdate(model.id, { id: event.target.value })}
      />
      <Select
        value={model.providerId}
        onChange={(event) =>
          onUpdate(model.id, { providerId: event.target.value })
        }
      >
        <option value="">{LABELS.selectProvider}</option>
        {registry.providers.map((provider) => (
          <option key={provider.id} value={provider.id}>
            {provider.id}
          </option>
        ))}
      </Select>
      <Input
        type="text"
        value={model.model}
        onChange={(event) => onUpdate(model.id, { model: event.target.value })}
        placeholder="gpt-5.5"
      />
      <TokenInput
        model={model}
        visible={visible}
        disabled={disabled}
        onToggleVisible={onToggleVisible}
        onUpdate={onUpdate}
      />
      <Input
        type="text"
        value={model.tokenEnv || ''}
        onChange={(event) =>
          onUpdate(model.id, { tokenEnv: optional(event.target.value) })
        }
        placeholder="OPENAI_API_KEY"
      />
      <DeleteButton disabled={disabled} onClick={() => onRemove(model.id)} />
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
  onUpdate: (id: string, patch: Partial<ModelConfig>) => void;
  onRemove: (id: string) => void;
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
        <span>ID</span>
        <span>Provider</span>
        <span>Model Name</span>
        <span>Token</span>
        <span>Token Env</span>
        <span />
      </div>
      <div className="divide-y divide-white/5">
        {registry.models.length === 0 && <EmptyRows label={LABELS.noModel} />}
        {registry.models.map((model) => (
          <ModelRow
            key={model.id}
            model={model}
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
