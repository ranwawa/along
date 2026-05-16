import { Input, Select } from '../components/ui/input';
import type { AgentConfig, RegistryConfig } from '../types';
import {
  DeleteButton,
  EmptyRows,
  optional,
  Section,
} from './registryTableParts';

const LABELS = {
  noAgent: '暂无 Agent',
  selectRuntime: '选择 Runtime',
  useRuntimeDefault: '使用 Runtime 默认',
  colId: 'ID',
  colRuntime: 'Runtime',
  colModel: 'Model',
  colPersonality: 'Personality',
} as const;

export function AgentRegistryRows({
  registry,
  disabled,
  onAdd,
  onUpdate,
  onRemove,
}: {
  registry: RegistryConfig;
  disabled: boolean;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<AgentConfig>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Section
      title="Agents"
      count={registry.agents.length}
      disabled={disabled}
      onAdd={onAdd}
    >
      <div className="hidden md:grid grid-cols-[150px_170px_minmax(0,1fr)_160px_84px] gap-3 px-4 py-2 border-b border-border-color text-xs font-semibold text-text-muted">
        <span>{LABELS.colId}</span>
        <span>{LABELS.colRuntime}</span>
        <span>{LABELS.colModel}</span>
        <span>{LABELS.colPersonality}</span>
        <span />
      </div>
      <div className="divide-y divide-white/5">
        {registry.agents.length === 0 && <EmptyRows label={LABELS.noAgent} />}
        {registry.agents.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
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

function AgentRow({
  agent,
  registry,
  disabled,
  onUpdate,
  onRemove,
}: {
  agent: AgentConfig;
  registry: RegistryConfig;
  disabled: boolean;
  onUpdate: (id: string, patch: Partial<AgentConfig>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[150px_170px_minmax(0,1fr)_160px_84px] gap-3 p-4 items-center">
      <Input
        type="text"
        value={agent.id}
        onChange={(event) => onUpdate(agent.id, { id: event.target.value })}
      />
      <Select
        value={agent.runtimeId}
        onChange={(event) =>
          onUpdate(agent.id, { runtimeId: event.target.value })
        }
      >
        <option value="">{LABELS.selectRuntime}</option>
        {registry.runtimes.map((item) => (
          <option key={item.id} value={item.id}>
            {item.id}
          </option>
        ))}
      </Select>
      <Select
        value={agent.modelId || ''}
        onChange={(event) =>
          onUpdate(agent.id, { modelId: optional(event.target.value) })
        }
      >
        <option value="">{LABELS.useRuntimeDefault}</option>
        {registry.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.id}
          </option>
        ))}
      </Select>
      <Input
        type="text"
        value={agent.personalityVersion || ''}
        onChange={(event) =>
          onUpdate(agent.id, {
            personalityVersion: optional(event.target.value),
          })
        }
        placeholder="version"
      />
      <DeleteButton disabled={disabled} onClick={() => onRemove(agent.id)} />
    </div>
  );
}
