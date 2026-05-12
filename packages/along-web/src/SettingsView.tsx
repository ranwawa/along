// biome-ignore-all lint/style/noJsxLiterals: existing settings view uses inline UI copy.
import { Alert } from './components/ui/alert';
import { Button } from './components/ui/button';
import { RegistrySettingsTables } from './settings/RegistrySettingsTables';
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
        <Button
          type="button"
          onClick={loadConfig}
          disabled={state.loading || state.saving}
        >
          {state.loading ? '刷新中' : '刷新'}
        </Button>
        <Button
          type="button"
          onClick={saveConfig}
          disabled={state.loading || state.saving}
          variant="default"
        >
          {state.saving ? '保存中' : '保存'}
        </Button>
      </div>
    </div>
  );
}

function SettingsAlerts({ state }: { state: SettingsState }) {
  return (
    <>
      {state.error && <Alert variant="error">{state.error}</Alert>}
      {state.savedAt && <Alert variant="success">已保存 {state.savedAt}</Alert>}
    </>
  );
}

export function SettingsView() {
  const settings = useSettingsController();
  const registry = settings.state.registry;
  return (
    <div className="flex-1 min-h-0 border-t border-border-color overflow-auto bg-bg-secondary">
      <div className="max-w-6xl mx-auto p-4 md:p-6 flex flex-col gap-5">
        <SettingsHeader
          state={settings.state}
          loadConfig={settings.loadConfig}
          saveConfig={settings.saveConfig}
        />
        <SettingsAlerts state={settings.state} />
        {registry && (
          <RegistrySettingsTables
            registry={registry}
            loading={settings.state.loading}
            saving={settings.state.saving}
            actions={settings.registryActions}
          />
        )}
      </div>
    </div>
  );
}
