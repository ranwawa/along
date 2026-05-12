// biome-ignore-all lint/style/noJsxLiterals: existing dashboard header uses inline navigation labels.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: header navigation and filters are kept together.
import { Button } from '../components/ui/button';
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
            <Button
              type="button"
              key={view}
              variant="ghost"
              size="sm"
              className={`rounded-md md:text-sm ${
                activeView === view ? 'bg-white/10 text-white' : ''
              }`}
              onClick={() => onViewChange(view)}
            >
              {view === 'tasks'
                ? 'Tasks'
                : view === 'sessions'
                  ? 'Sessions'
                  : 'Settings'}
            </Button>
          ))}
        </div>
        {activeView === 'sessions' &&
          statusFilters.map((filter) => (
            <Button
              type="button"
              key={filter}
              variant={currentFilter === filter ? 'outline' : 'ghost'}
              size="sm"
              className={`rounded-md md:text-sm ${
                currentFilter === filter ? 'bg-white/10 text-white' : ''
              }`}
              onClick={() => onFilterChange(filter)}
            >
              {filter === 'all' ? 'All' : getLifecycleLabel(filter)}
              {filter !== 'all' && (
                <span className="opacity-60 ml-1.5">
                  {getFilterCount(filter)}
                </span>
              )}
            </Button>
          ))}
      </div>
    </header>
  );
}
