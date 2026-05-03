import type { StatusCounts } from '../types';
import {
  getLifecycleLabel,
  type StatusFilter,
  statusFilters,
} from './sessionUtils';

export type DashboardView = 'tasks' | 'sessions' | 'settings';

export function AppHeader({
  activeView,
  currentFilter,
  counts,
  onViewChange,
  onFilterChange,
}: {
  activeView: DashboardView;
  currentFilter: StatusFilter;
  counts: StatusCounts;
  onViewChange: (view: DashboardView) => void;
  onFilterChange: (filter: StatusFilter) => void;
}) {
  const getFilterCount = (filter: StatusFilter) =>
    filter === 'all' ? counts.total : counts[filter];

  return (
    <header className="flex flex-col gap-3 md:flex-row md:justify-between md:items-center px-4 py-4 md:px-6 md:py-5 border-b border-border-color shrink-0">
      <h1 className="font-semibold text-xl md:text-2xl tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
        ALONG
      </h1>
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex rounded-lg border border-border-color bg-black/20 p-1">
          {(['tasks', 'sessions', 'settings'] as const).map((view) => (
            <button
              type="button"
              key={view}
              className={`px-3 py-1.5 rounded-md text-xs md:text-sm font-semibold transition-all ${
                activeView === view
                  ? 'bg-white/10 text-white'
                  : 'text-text-secondary hover:bg-white/5'
              }`}
              onClick={() => onViewChange(view)}
            >
              {view === 'tasks'
                ? 'Tasks'
                : view === 'sessions'
                  ? 'Sessions'
                  : 'Settings'}
            </button>
          ))}
        </div>
        {activeView === 'sessions' &&
          statusFilters.map((filter) => (
            <button
              type="button"
              key={filter}
              className={`px-2.5 py-1 md:px-3 md:py-1.5 rounded-md cursor-pointer text-xs md:text-sm transition-all border ${
                currentFilter === filter
                  ? 'bg-white/10 text-white border-border-color'
                  : 'bg-transparent border-transparent text-text-secondary hover:bg-white/5'
              }`}
              onClick={() => onFilterChange(filter)}
            >
              {filter === 'all' ? 'All' : getLifecycleLabel(filter)}
              {filter !== 'all' && (
                <span className="opacity-60 ml-1.5">
                  {getFilterCount(filter)}
                </span>
              )}
            </button>
          ))}
      </div>
    </header>
  );
}
