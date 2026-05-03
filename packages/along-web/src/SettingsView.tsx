import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgentRowsTable } from './settings/AgentRowsTable';
import type { ConfigRow } from './settings/types';
import type {
  EditorOption,
  GlobalConfigResponse,
  TaskAgentConfig,
} from './types';

interface ConfigApiError {
  error?: string;
}

const defaultRows: ConfigRow[] = [
  { key: '*', editor: 'claude', model: '', personalityVersion: '' },
  { key: 'planner', editor: 'claude', model: '', personalityVersion: '' },
  { key: 'implementer', editor: 'claude', model: '', personalityVersion: '' },
];

function isConfigApiError(value: unknown): value is ConfigApiError {
  return value !== null && typeof value === 'object' && 'error' in value;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      isConfigApiError(payload) && typeof payload.error === 'string'
        ? payload.error
        : `请求失败: ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function configToRows(response: GlobalConfigResponse): ConfigRow[] {
  const keys = new Set([
    ...defaultRows.map((row) => row.key),
    ...Object.keys(response.defaults.taskAgents),
    ...Object.keys(response.taskAgents),
  ]);

  return [...keys].map((key) => {
    const config =
      response.taskAgents[key] ||
      response.defaults.taskAgents[key] ||
      defaultRows.find((row) => row.key === key);
    return {
      key,
      editor: config?.editor || 'claude',
      model: config?.model || '',
      personalityVersion: config?.personalityVersion || '',
    };
  });
}

function rowsToTaskAgents(rows: ConfigRow[]): Record<string, TaskAgentConfig> {
  const result: Record<string, TaskAgentConfig> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    result[key] = {
      editor: row.editor.trim() || undefined,
      model: row.model.trim() || undefined,
      personalityVersion: row.personalityVersion.trim() || undefined,
    };
  }
  return result;
}

export function SettingsView() {
  const [configPath, setConfigPath] = useState('');
  const [editors, setEditors] = useState<EditorOption[]>([]);
  const [rows, setRows] = useState<ConfigRow[]>(defaultRows);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/config');
      const result = await readJsonResponse<GlobalConfigResponse>(response);
      setConfigPath(result.configPath);
      setEditors(result.editors);
      setRows(configToRows(result));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((left, right) => {
      if (left.key === '*') return -1;
      if (right.key === '*') return 1;
      return left.key.localeCompare(right.key);
    });
  }, [rows]);

  const updateRow = (key: string, patch: Partial<ConfigRow>) => {
    setRows((previous) =>
      previous.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
    setSavedAt(null);
  };

  const addRow = () => {
    let index = 1;
    let key = `agent-${index}`;
    const existing = new Set(rows.map((row) => row.key));
    while (existing.has(key)) {
      index += 1;
      key = `agent-${index}`;
    }
    setRows((previous) => [
      ...previous,
      {
        key,
        editor: editors[0]?.id || 'claude',
        model: '',
        personalityVersion: '',
      },
    ]);
    setSavedAt(null);
  };

  const removeRow = (key: string) => {
    setRows((previous) => previous.filter((row) => row.key !== key));
    setSavedAt(null);
  };

  const saveConfig = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskAgents: rowsToTaskAgents(rows) }),
      });
      const result = await readJsonResponse<GlobalConfigResponse>(response);
      setConfigPath(result.configPath);
      setEditors(result.editors);
      setRows(configToRows(result));
      setSavedAt(new Date().toLocaleTimeString('zh-CN'));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 border-t border-border-color overflow-auto bg-bg-secondary">
      <div className="max-w-6xl mx-auto p-4 md:p-6 flex flex-col gap-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg md:text-xl font-semibold">
              Global Settings
            </h2>
            <div className="text-xs text-text-muted truncate mt-1">
              {configPath || '~/.along/config.json'}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={loadConfig}
              disabled={loading || saving}
              className="px-3 py-2 rounded-lg text-sm font-semibold border border-border-color text-text-secondary hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '刷新中' : '刷新'}
            </button>
            <button
              type="button"
              onClick={saveConfig}
              disabled={loading || saving}
              className="px-3 py-2 rounded-lg text-sm font-semibold bg-brand text-white border border-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? '保存中' : '保存'}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        {savedAt && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            已保存 {savedAt}
          </div>
        )}

        <AgentRowsTable
          rows={sortedRows}
          editors={editors}
          loading={loading}
          saving={saving}
          onAdd={addRow}
          onUpdate={updateRow}
          onRemove={removeRow}
        />
      </div>
    </div>
  );
}
