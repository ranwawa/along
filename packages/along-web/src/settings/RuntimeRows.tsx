import { Input, Select } from '../components/ui/input';
import type { RegistryConfig, RuntimeConfig } from '../types';
import {
  DeleteButton,
  EmptyRows,
  optional,
  Section,
} from './registryTableParts';

const LABELS = { noRuntime: '暂无 Runtime', notSet: '未设置' } as const;

function RuntimeRow({
  runtime,
  registry,
  disabled,
  onUpdate,
  onRemove,
}: {
  runtime: RuntimeConfig;
  registry: RegistryConfig;
  disabled: boolean;
  onUpdate: (id: string, patch: Partial<RuntimeConfig>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[150px_120px_minmax(0,1fr)_84px] gap-3 p-4 items-center">
      <Input
        type="text"
        value={runtime.id}
        onChange={(event) => onUpdate(runtime.id, { id: event.target.value })}
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
          onUpdate(runtime.id, { modelId: optional(event.target.value) })
        }
      >
        <option value="">{LABELS.notSet}</option>
        {registry.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.id}
          </option>
        ))}
      </Select>
      <DeleteButton disabled={disabled} onClick={() => onRemove(runtime.id)} />
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
      <div className="hidden md:grid grid-cols-[150px_120px_minmax(0,1fr)_84px] gap-3 px-4 py-2 border-b border-border-color text-xs font-semibold text-text-muted">
        <span>ID</span>
        <span>Kind</span>
        <span>Model</span>
        <span />
      </div>
      <div className="divide-y divide-white/5">
        {registry.runtimes.length === 0 && (
          <EmptyRows label={LABELS.noRuntime} />
        )}
        {registry.runtimes.map((runtime) => (
          <RuntimeRow
            key={runtime.id}
            runtime={runtime}
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
