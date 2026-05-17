import { ArrowLeft, RefreshCw, Save } from 'lucide-react';
import { Alert } from './components/ui/alert';
import { Button } from './components/ui/button';
import { RegistrySettingsTables } from './settings/RegistrySettingsTables';
import {
  type SettingsState,
  useSettingsController,
} from './settings/useSettingsController';

const LABELS = {
  refreshing: '刷新中',
  refresh: '刷新',
  saving: '保存中',
  save: '保存',
  saved: '已保存',
  globalSettings: 'Global Settings',
  configPath: '~/.along/config.json',
} as const;

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
        <h2 className="text-lg md:text-xl font-semibold">
          {LABELS.globalSettings}
        </h2>
        <div className="text-xs text-text-muted truncate mt-1">
          {state.configPath || LABELS.configPath}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button
          type="button"
          onClick={loadConfig}
          disabled={state.loading || state.saving}
          className="gap-1.5"
        >
          <RefreshCw
            aria-hidden="true"
            className={`h-4 w-4 ${state.loading ? 'animate-spin' : ''}`}
          />
          {state.loading ? LABELS.refreshing : LABELS.refresh}
        </Button>
        <Button
          type="button"
          onClick={saveConfig}
          disabled={state.loading || state.saving}
          variant="default"
          className="gap-1.5"
        >
          <Save aria-hidden="true" className="h-4 w-4" />
          {state.saving ? LABELS.saving : LABELS.save}
        </Button>
      </div>
    </div>
  );
}

function SettingsAlerts({ state }: { state: SettingsState }) {
  return (
    <>
      {state.error && <Alert variant="error">{state.error}</Alert>}
      {state.savedAt && (
        <Alert variant="success">
          {LABELS.saved} {state.savedAt}
        </Alert>
      )}
    </>
  );
}

export function SettingsView({ onBack }: { onBack: () => void }) {
  const settings = useSettingsController();
  const registry = settings.state.registry;
  return (
    <div className="flex-1 min-h-0 border-t border-border-color overflow-auto bg-bg-secondary">
      <div className="max-w-6xl mx-auto p-4 md:p-6 flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            aria-label="返回"
            onClick={onBack}
            size="icon"
            className="h-8 w-8"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
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
