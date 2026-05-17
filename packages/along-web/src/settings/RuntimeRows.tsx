import { Input, Select } from '../components/ui/input';
import type { RegistryConfig, RuntimeConfig } from '../types';
import {
  DeleteButton,
  EmptyRows,
  optional,
  Section,
} from './registryTableParts';
import { getKey } from './stableKey';

const LABELS = {
  noRuntime: '暂无 Runtime',
  notSet: '未设置',
  colId: 'ID',
  colKind: 'Kind',
  colModel: 'Model',
} as const;

function RuntimeRow({
  runtime,
  index,
  registry,
  disabled,
  onUpdate,
  onRemove,
}: {
  runtime: RuntimeConfig;
  index: number;
  registry: RegistryConfig;
  disabled: boolean;
  onUpdate: (index: number, patch: Partial<RuntimeConfig>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[150px_120px_minmax(0,1fr)_84px] gap-3 p-4 items-center">
      <Input
        type="text"
        value={runtime.id}
        onChange={(event) => onUpdate(index, { id: event.target.value })}
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
          onUpdate(index, { modelId: optional(event.target.value) })
        }
      >
        <option value="">{LABELS.notSet}</option>
        {registry.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.id}
          </option>
        ))}
      </Select>
      <DeleteButton disabled={disabled} onClick={() => onRemove(index)} />
    </div>
  );
}

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
  onUpdate: (index: number, patch: Partial<RuntimeConfig>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <Section
      title="Runtimes"
      count={registry.runtimes.length}
      disabled={disabled}
      onAdd={onAdd}
    >
      <div className="hidden md:grid grid-cols-[150px_120px_minmax(0,1fr)_84px] gap-3 px-4 py-2 border-b border-border-color text-xs font-semibold text-text-muted">
        <span>{LABELS.colId}</span>
        <span>{LABELS.colKind}</span>
        <span>{LABELS.colModel}</span>
        <span />
      </div>
      <div className="divide-y divide-white/5">
        {registry.runtimes.length === 0 && (
          <EmptyRows label={LABELS.noRuntime} />
        )}
        {registry.runtimes.map((runtime, index) => (
          <RuntimeRow
            key={getKey(runtime)}
            runtime={runtime}
            index={index}
            registry={registry}
            disabled={disabled}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))}
      </div>
    </Section>
  );
}
