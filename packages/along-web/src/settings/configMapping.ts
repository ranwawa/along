import type {
  GlobalConfigResponse,
  ProviderConfig,
  TaskAgentConfig,
} from '../types';
import type { ConfigRow, ProviderRow } from './types';

export const defaultRows: ConfigRow[] = [
  { key: '*', editor: 'claude', model: '', personalityVersion: '' },
  { key: 'planner', editor: 'claude', model: '', personalityVersion: '' },
  { key: 'implementer', editor: 'claude', model: '', personalityVersion: '' },
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
      editor: config?.editor || 'claude',
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

export function configToProviderRows(
  response: GlobalConfigResponse,
): ProviderRow[] {
  const keys = new Set([
    ...Object.keys(response.defaults.providers),
    ...Object.keys(response.providers),
  ]);

  return [...keys].map((id) => {
    const config = {
      ...response.defaults.providers[id],
      ...response.providers[id],
    };
    return {
      id,
      name: config?.name || id,
      baseUrl: config?.baseUrl || '',
      modelsText: (config?.models || []).join('\n'),
      token: '',
      tokenConfigured: Boolean(config?.tokenConfigured),
      tokenPreview: config?.tokenPreview || '',
    };
  });
}

export function rowsToProviders(
  rows: ProviderRow[],
): Record<string, ProviderConfig> {
  const result: Record<string, ProviderConfig> = {};
  for (const row of rows) {
    const id = row.id.trim();
    if (!id) continue;
    const models = row.modelsText
      .split(/[\n,]/)
      .map((model) => model.trim())
      .filter(Boolean);
    result[id] = {
      name: row.name.trim() || undefined,
      baseUrl: row.baseUrl.trim() || undefined,
      models,
      token: row.token.trim() || undefined,
    };
  }
  return result;
}
