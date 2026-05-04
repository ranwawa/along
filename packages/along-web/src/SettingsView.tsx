import { AgentRowsTable } from './settings/AgentRowsTable';
import { ProviderRowsTable } from './settings/ProviderRowsTable';
import {
  type SettingsState,
  useSettingsController,
} from './settings/useSettingsController';

function SettingsHeader({
  state,
  loadConfig,
  saveConfig,
}: {
  state: SettingsState;
  loadConfig: () => void;
  saveConfig: () => void;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg md:text-xl font-semibold">Global Settings</h2>
        <div className="text-xs text-text-muted truncate mt-1">
          {state.configPath || '~/.along/config.json'}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          type="button"
          onClick={loadConfig}
          disabled={state.loading || state.saving}
          className="px-3 py-2 rounded-lg text-sm font-semibold border border-border-color text-text-secondary hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state.loading ? '刷新中' : '刷新'}
        </button>
        <button
          type="button"
          onClick={saveConfig}
          disabled={state.loading || state.saving}
          className="px-3 py-2 rounded-lg text-sm font-semibold bg-brand text-white border border-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state.saving ? '保存中' : '保存'}
        </button>
      </div>
    </div>
  );
}

function SettingsAlerts({ state }: { state: SettingsState }) {
  return (
    <>
      {state.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </div>
      )}
      {state.savedAt && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          已保存 {state.savedAt}
        </div>
      )}
    </>
  );
}

export function SettingsView() {
  const settings = useSettingsController();
  return (
    <div className="flex-1 min-h-0 border-t border-border-color overflow-auto bg-bg-secondary">
      <div className="max-w-6xl mx-auto p-4 md:p-6 flex flex-col gap-5">
        <SettingsHeader
          state={settings.state}
          loadConfig={settings.loadConfig}
          saveConfig={settings.saveConfig}
        />
        <SettingsAlerts state={settings.state} />
        <AgentRowsTable
          rows={settings.rows.sortedRows}
          editors={settings.state.editors}
          loading={settings.state.loading}
          saving={settings.state.saving}
          onAdd={settings.agentActions.addRow}
          onUpdate={settings.agentActions.updateRow}
          onRemove={settings.agentActions.removeRow}
        />
        <ProviderRowsTable
          rows={settings.rows.sortedProviderRows}
          loading={settings.state.loading}
          saving={settings.state.saving}
          onAdd={settings.providerActions.addProviderRow}
          onUpdate={settings.providerActions.updateProviderRow}
          onRemove={settings.providerActions.removeProviderRow}
        />
      </div>
    </div>
  );
}
