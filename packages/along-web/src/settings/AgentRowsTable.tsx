import { Trash2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
import { Section } from '../components/ui/section';
import type { RuntimeConfig } from '../types';
import type { AgentRow } from './types';

const LABELS = {
  delete: '删除',
  agent: 'Agent',
  runtime: 'Runtime',
  model: 'Model',
  personality: 'Personality',
} as const;

function AgentTableRow({
  row,
  runtimes,
  loading,
  saving,
  onUpdate,
  onRemove,
}: {
  row: AgentRow;
  runtimes: RuntimeConfig[];
  loading: boolean;
  saving: boolean;
  onUpdate: (id: string, patch: Partial<AgentRow>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[180px_180px_minmax(0,1fr)_180px_84px] gap-3 p-4 items-center">
      <Input
        type="text"
        value={row.id}
        onChange={(event) => onUpdate(row.id, { id: event.target.value })}
      />
      <Select
        value={row.runtimeId}
        onChange={(event) =>
          onUpdate(row.id, { runtimeId: event.target.value })
        }
      >
        {runtimes.map((runtime) => (
          <option key={runtime.id} value={runtime.id}>
            {runtime.name || runtime.id}
          </option>
        ))}
      </Select>
      <Input
        type="text"
        value={row.modelId}
        onChange={(event) => onUpdate(row.id, { modelId: event.target.value })}
        placeholder="model id"
      />
      <Input
        type="text"
        value={row.personalityVersion}
        onChange={(event) =>
          onUpdate(row.id, { personalityVersion: event.target.value })
        }
        placeholder="version"
      />
      <Button
        type="button"
        onClick={() => onRemove(row.id)}
        disabled={loading || saving}
        size="sm"
        className="gap-1.5"
      >
        <Trash2 aria-hidden="true" className="h-4 w-4" />
        {LABELS.delete}
      </Button>
    </div>
  );
}

export function AgentRowsTable({
  rows,
  runtimes,
  loading,
  saving,
  onAdd,
  onUpdate,
  onRemove,
}: {
  rows: AgentRow[];
  runtimes: RuntimeConfig[];
  loading: boolean;
  saving: boolean;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<AgentRow>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Section title="Agents" disabled={loading || saving} onAdd={onAdd}>
      <div className="hidden md:grid grid-cols-[180px_180px_minmax(0,1fr)_180px_84px] gap-3 px-4 py-2 border-b border-border-color text-xs font-semibold text-text-muted">
        <span>{LABELS.agent}</span>
        <span>{LABELS.runtime}</span>
        <span>{LABELS.model}</span>
        <span>{LABELS.personality}</span>
        <span />
      </div>
      <div className="divide-y divide-white/5">
        {rows.map((row) => (
          <AgentTableRow
            key={row.id}
            row={row}
            runtimes={runtimes}
            loading={loading}
            saving={saving}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))}
      </div>
    </Section>
  );
}
