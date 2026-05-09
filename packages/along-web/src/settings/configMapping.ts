import type { GlobalConfigResponse, TaskAgentConfig } from '../types';
import type { ConfigRow } from './types';

export const defaultRows: ConfigRow[] = [
  { key: '*', editor: 'codex', model: '', personalityVersion: '' },
  { key: 'planner', editor: 'codex', model: '', personalityVersion: '' },
  { key: 'implementer', editor: 'codex', model: '', personalityVersion: '' },
];

export function configToRows(response: GlobalConfigResponse): ConfigRow[] {
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
      editor: config?.editor || 'codex',
      model: config?.model || '',
      personalityVersion: config?.personalityVersion || '',
    };
  });
}

export function rowsToTaskAgents(
  rows: ConfigRow[],
): Record<string, TaskAgentConfig> {
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
