import { useState } from 'react';
import { AppHeader, type DashboardView } from './dashboard/AppHeader';
import { SessionsView } from './dashboard/SessionsView';
import { useDashboardSessions } from './dashboard/useDashboardSessions';
import { SettingsView } from './SettingsView';
import { TaskPlanningView } from './TaskPlanningView';
import './index.css';

function App() {
  const [activeView, setActiveView] = useState<DashboardView>('tasks');
  const sessions = useDashboardSessions();

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden">
      <AppHeader
        activeView={activeView}
        currentFilter={sessions.currentFilter}
        counts={sessions.counts}
        onViewChange={setActiveView}
        onFilterChange={sessions.setCurrentFilter}
      />
      {activeView === 'tasks' ? (
        <TaskPlanningView />
      ) : activeView === 'settings' ? (
        <SettingsView />
      ) : (
        <SessionsView sessions={sessions} />
      )}
    </div>
  );
}

export default App;
