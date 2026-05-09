import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { EditorOption, GlobalConfigResponse } from '../types';
import { configToRows, defaultRows, rowsToTaskAgents } from './configMapping';
import type { ConfigRow } from './types';

interface ConfigApiError {
  error?: string;
}

export interface SettingsState {
  configPath: string;
  editors: EditorOption[];
  rows: ConfigRow[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  savedAt: string | null;
}

const initialSettingsState: SettingsState = {
  configPath: '',
  editors: [],
  rows: defaultRows,
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
      const result = await readJsonResponse<GlobalConfigResponse>(
        await fetch('/api/config'),
      );
      setState((previous) => ({
        ...previous,
        configPath: result.configPath,
        editors: result.editors,
        rows: configToRows(result),
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
    return [...state.rows].sort((left, right) => {
      if (left.key === '*') return -1;
      if (right.key === '*') return 1;
      return left.key.localeCompare(right.key);
    });
  }, [state.rows]);
  return { sortedRows };
}

function nextKey(prefix: string, existing: string[]) {
  let index = 1;
  let key = `${prefix}-${index}`;
  const keys = new Set(existing);
  while (keys.has(key)) {
    index += 1;
    key = `${prefix}-${index}`;
  }
  return key;
}

function useAgentRowActions(state: SettingsState, setState: SetSettingsState) {
  const updateRow = (key: string, patch: Partial<ConfigRow>) => {
    setState((previous) => ({
      ...previous,
      rows: previous.rows.map((row) =>
        row.key === key ? { ...row, ...patch } : row,
      ),
      savedAt: null,
    }));
  };
  const addRow = () => {
    const key = nextKey(
      'agent',
      state.rows.map((row) => row.key),
    );
    setState((previous) => ({
      ...previous,
      rows: [...previous.rows, createAgentRow(key, state.editors)],
      savedAt: null,
    }));
  };
  const removeRow = (key: string) => {
    setState((previous) => ({
      ...previous,
      rows: previous.rows.filter((row) => row.key !== key),
      savedAt: null,
    }));
  };
  return { updateRow, addRow, removeRow };
}

function createAgentRow(key: string, editors: EditorOption[]): ConfigRow {
  return {
    key,
    editor: editors[0]?.id || 'codex',
    model: '',
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
        configPath: result.configPath,
        editors: result.editors,
        rows: configToRows(result),
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
  const response = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskAgents: rowsToTaskAgents(state.rows),
    }),
  });
  return readJsonResponse<GlobalConfigResponse>(response);
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
