import { useState } from 'react';
import { SettingsView } from './SettingsView';
import { TaskPlanningView } from './TaskPlanningView';
import './index.css';

type AppView = 'tasks' | 'settings';

function App() {
  const [activeView, setActiveView] = useState<AppView>('tasks');

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden">
      {activeView === 'tasks' ? <TaskPlanningView /> : <SettingsView />}
    </div>
  );
}

export default App;
