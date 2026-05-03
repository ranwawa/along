import type { EditorOption } from '../types';
import type { ConfigRow } from './types';

export function AgentRowsTable({
  rows,
  editors,
  loading,
  saving,
  onAdd,
  onUpdate,
  onRemove,
}: {
  rows: ConfigRow[];
  editors: EditorOption[];
  loading: boolean;
  saving: boolean;
  onAdd: () => void;
  onUpdate: (key: string, patch: Partial<ConfigRow>) => void;
  onRemove: (key: string) => void;
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
        <span>Editor</span>
        <span>Model</span>
        <span>Personality</span>
        <span />
      </div>

      <div className="divide-y divide-white/5">
        {rows.map((row) => (
          <div
            key={row.key}
            className="grid grid-cols-1 md:grid-cols-[180px_180px_minmax(0,1fr)_180px_84px] gap-3 p-4 items-center"
          >
            <input
              type="text"
              value={row.key}
              disabled={row.key === '*'}
              onChange={(event) =>
                onUpdate(row.key, { key: event.target.value })
              }
              className="bg-black/35 border border-border-color rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand/60 disabled:opacity-60"
            />
            <select
              value={row.editor}
              onChange={(event) =>
                onUpdate(row.key, { editor: event.target.value })
              }
              className="bg-black/35 border border-border-color rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand/60"
            >
              {editors.map((editor) => (
                <option key={editor.id} value={editor.id}>
                  {editor.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={row.model}
              onChange={(event) =>
                onUpdate(row.key, { model: event.target.value })
              }
              placeholder="model"
              className="bg-black/35 border border-border-color rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand/60"
            />
            <input
              type="text"
              value={row.personalityVersion}
              onChange={(event) =>
                onUpdate(row.key, {
                  personalityVersion: event.target.value,
                })
              }
              placeholder="version"
              className="bg-black/35 border border-border-color rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand/60"
            />
            <button
              type="button"
              onClick={() => onRemove(row.key)}
              disabled={row.key === '*' || loading || saving}
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
