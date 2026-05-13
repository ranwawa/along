import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from 'react';
import type { RegistryConfig } from '../types';
import { useRegistryActions } from './registryActions';

interface ConfigApiError {
  error?: string;
}

export interface SettingsState {
  configPath: string;
  registry: RegistryConfig | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  savedAt: string | null;
}

const emptyRegistry: RegistryConfig = {
  providers: [],
  models: [],
  runtimes: [],
  agents: [],
  profiles: [],
};

const initialSettingsState: SettingsState = {
  configPath: '~/.along/config.json',
  registry: null,
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

function useSaveConfig(state: SettingsState, setState: SetSettingsState) {
  return async () => {
    if (state.saving) return;
    setState((previous) => ({ ...previous, saving: true, error: null }));
    try {
      const result = await putSettingsConfig(state);
      setState((previous) => ({
        ...previous,
        registry: result,
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
    body: JSON.stringify(registry),
  });
  return readJsonResponse<RegistryConfig>(response);
}

export function useSettingsController() {
  const { state, setState, loadConfig } = useSettingsData();
  return {
    state,
    registryActions: useRegistryActions(setState),
    loadConfig,
    saveConfig: useSaveConfig(state, setState),
  };
}
