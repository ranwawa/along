import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { RegistryConfig } from '../types';
import { registryToRows, rowsToAgents } from './configMapping';
import type { AgentRow } from './types';

interface ConfigApiError {
  error?: string;
}

export interface SettingsState {
  configPath: string;
  registry: RegistryConfig | null;
  rows: AgentRow[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  savedAt: string | null;
}

const emptyRegistry: RegistryConfig = {
  providers: [],
  credentials: [],
  models: [],
  runtimes: [],
  agents: [],
  profiles: [],
};

const initialSettingsState: SettingsState = {
  configPath: '~/.along/config.json',
  registry: null,
  rows: [],
  loading: false,
  saving: false,
  error: null,
  savedAt: null,
};

type SetSettingsState = Dispatch<SetStateAction<SettingsState>>;

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

function useSettingsData() {
  const [state, setState] = useState<SettingsState>(initialSettingsState);
  const loadConfig = useCallback(async () => {
    setState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const result = await readJsonResponse<RegistryConfig>(
        await fetch('/api/registry'),
      );
      setState((previous) => ({
        ...previous,
        registry: result,
        rows: registryToRows(result),
        loading: false,
      }));
    } catch (err: unknown) {
      setState((previous) => ({
        ...previous,
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      }));
    }
  }, []);
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);
  return { state, setState, loadConfig };
}

function useSortedRows(state: SettingsState) {
  const sortedRows = useMemo(() => {
    return [...state.rows].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
  }, [state.rows]);
  return { sortedRows };
}

function nextId(prefix: string, existing: string[]) {
  let index = 1;
  let id = `${prefix}-${index}`;
  const ids = new Set(existing);
  while (ids.has(id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

function useAgentRowActions(state: SettingsState, setState: SetSettingsState) {
  const updateRow = (id: string, patch: Partial<AgentRow>) => {
    setState((previous) => ({
      ...previous,
      rows: previous.rows.map((row) =>
        row.id === id ? { ...row, ...patch } : row,
      ),
      savedAt: null,
    }));
  };
  const addRow = () => {
    const id = nextId(
      'agent',
      state.rows.map((row) => row.id),
    );
    setState((previous) => ({
      ...previous,
      rows: [...previous.rows, createAgentRow(id, state.registry)],
      savedAt: null,
    }));
  };
  const removeRow = (id: string) => {
    setState((previous) => ({
      ...previous,
      rows: previous.rows.filter((row) => row.id !== id),
      savedAt: null,
    }));
  };
  return { updateRow, addRow, removeRow };
}

function createAgentRow(id: string, registry: RegistryConfig | null): AgentRow {
  return {
    id,
    runtimeId: registry?.runtimes[0]?.id || 'codex',
    modelId: '',
    credentialId: '',
    personalityVersion: '',
  };
}

function useSaveConfig(state: SettingsState, setState: SetSettingsState) {
  return async () => {
    if (state.saving) return;
    setState((previous) => ({ ...previous, saving: true, error: null }));
    try {
      const result = await putSettingsConfig(state);
      setState((previous) => ({
        ...previous,
        registry: result,
        rows: registryToRows(result),
        saving: false,
        savedAt: new Date().toLocaleTimeString('zh-CN'),
      }));
    } catch (err: unknown) {
      setState((previous) => ({
        ...previous,
        error: err instanceof Error ? err.message : String(err),
        saving: false,
      }));
    }
  };
}

async function putSettingsConfig(state: SettingsState) {
  const registry = state.registry || emptyRegistry;
  const response = await fetch('/api/registry', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...registry,
      agents: rowsToAgents(state.rows),
    }),
  });
  return readJsonResponse<RegistryConfig>(response);
}

export function useSettingsController() {
  const { state, setState, loadConfig } = useSettingsData();
  return {
    state,
    rows: useSortedRows(state),
    agentActions: useAgentRowActions(state, setState),
    loadConfig,
    saveConfig: useSaveConfig(state, setState),
  };
}
