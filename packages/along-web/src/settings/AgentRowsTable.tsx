// biome-ignore-all lint/style/noJsxLiterals: settings table uses compact inline labels.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: table rendering is kept together for readability.
import type { RuntimeConfig } from '../types';
import type { AgentRow } from './types';

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
    <section className="rounded-lg border border-border-color bg-black/25 overflow-hidden">
      <div className="px-4 py-3 border-b border-border-color flex items-center justify-between gap-3">
        <div className="font-semibold text-sm text-text-secondary">
          Task Agents
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={loading || saving}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border-color text-text-secondary hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          新增
        </button>
      </div>

      <div className="hidden md:grid grid-cols-[180px_180px_minmax(0,1fr)_180px_84px] gap-3 px-4 py-2 border-b border-border-color text-xs font-semibold text-text-muted">
        <span>Agent</span>
        <span>Runtime</span>
        <span>Model</span>
        <span>Personality</span>
        <span />
      </div>

      <div className="divide-y divide-white/5">
        {rows.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-1 md:grid-cols-[180px_180px_minmax(0,1fr)_180px_84px] gap-3 p-4 items-center"
          >
            <input
              type="text"
              value={row.id}
              onChange={(event) => onUpdate(row.id, { id: event.target.value })}
              className="bg-black/35 border border-border-color rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand/60"
            />
            <select
              value={row.runtimeId}
              onChange={(event) =>
                onUpdate(row.id, { runtimeId: event.target.value })
              }
              className="bg-black/35 border border-border-color rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand/60"
            >
              {runtimes.map((runtime) => (
                <option key={runtime.id} value={runtime.id}>
                  {runtime.name || runtime.id}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={row.modelId}
              onChange={(event) =>
                onUpdate(row.id, { modelId: event.target.value })
              }
              placeholder="model id"
              className="bg-black/35 border border-border-color rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand/60"
            />
            <input
              type="text"
              value={row.personalityVersion}
              onChange={(event) =>
                onUpdate(row.id, {
                  personalityVersion: event.target.value,
                })
              }
              placeholder="version"
              className="bg-black/35 border border-border-color rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand/60"
            />
            <button
              type="button"
              onClick={() => onRemove(row.id)}
              disabled={loading || saving}
              className="px-3 py-2 rounded-lg text-xs font-semibold border border-border-color text-text-secondary hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
