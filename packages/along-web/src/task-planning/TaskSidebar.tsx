import type { ReactNode } from 'react';
import type { TaskPlanningSnapshot } from '../types';
import type { DraftTaskInput, RepositoryOption } from './api';
import { TaskStatusBadge } from './TaskStatusBadge';

const EMPTY_REPOSITORY_LABEL = '暂无已注册仓库';
const LOADING_TASKS_TEXT = '加载中...';
const EMPTY_TASKS_TEXT = '暂无任务。';
const NEW_TASK_ICON = '+';
const TASK_SEQ_PREFIX = '#';

function PopupTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="relative inline-flex group">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-[calc(100%+6px)] z-20 whitespace-nowrap rounded-md border border-border-color bg-bg-secondary px-2 py-1 text-xs text-text-secondary opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

function RepositoryControls({
  draft,
  repositories,
  selectedRepository,
  repositoriesRefreshing,
  error,
  onDraftChange,
  onRefreshRepositories,
}: {
  draft: DraftTaskInput;
  repositories: RepositoryOption[];
  selectedRepository?: RepositoryOption;
  repositoriesRefreshing: boolean;
  error: string | null;
  onDraftChange: (key: keyof DraftTaskInput, value: string) => void;
  onRefreshRepositories: () => void;
}) {
  return (
    <div className="min-w-0 flex-1 flex flex-col gap-2">
      <div className="flex gap-2">
        <select
          aria-label="仓库"
          value={draft.repository}
          onChange={(event) => onDraftChange('repository', event.target.value)}
          className="min-w-0 flex-1 bg-black/30 border border-border-color rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand/60"
        >
          {repositories.length === 0 ? (
            <option value="">{EMPTY_REPOSITORY_LABEL}</option>
          ) : (
            repositories.map((repository) => (
              <option key={repository.fullName} value={repository.fullName}>
                {repository.fullName}
                {repository.isDefault ? ' · 默认' : ''}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          onClick={onRefreshRepositories}
          disabled={repositoriesRefreshing}
          className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold border border-border-color text-text-secondary hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {repositoriesRefreshing ? '刷新中' : '刷新'}
        </button>
      </div>
      {selectedRepository && (
        <div className="text-xs text-text-muted truncate">
          {selectedRepository.path}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}

export function TaskListPanel({
  draft,
  repositories,
  selectedRepository,
  repositoriesRefreshing,
  error,
  tasks,
  loading,
  selectedTaskId,
  isNewTaskOpen,
  onDraftChange,
  onRefreshRepositories,
  onNewTask,
  onSelect,
}: {
  draft: DraftTaskInput;
  repositories: RepositoryOption[];
  selectedRepository?: RepositoryOption;
  repositoriesRefreshing: boolean;
  error: string | null;
  tasks: TaskPlanningSnapshot[];
  loading: boolean;
  selectedTaskId?: string;
  isNewTaskOpen: boolean;
  onDraftChange: (key: keyof DraftTaskInput, value: string) => void;
  onRefreshRepositories: () => void;
  onNewTask: () => void;
  onSelect: (snapshot: TaskPlanningSnapshot) => void;
}) {
  return (
    <>
      <TaskListHeader
        draft={draft}
        repositories={repositories}
        selectedRepository={selectedRepository}
        repositoriesRefreshing={repositoriesRefreshing}
        error={error}
        isNewTaskOpen={isNewTaskOpen}
        onDraftChange={onDraftChange}
        onRefreshRepositories={onRefreshRepositories}
        onNewTask={onNewTask}
      />
      <TaskListContent
        tasks={tasks}
        loading={loading}
        selectedTaskId={selectedTaskId}
        onSelect={onSelect}
      />
    </>
  );
}

function TaskListContent({
  tasks,
  loading,
  selectedTaskId,
  onSelect,
}: {
  tasks: TaskPlanningSnapshot[];
  loading: boolean;
  selectedTaskId?: string;
  onSelect: (snapshot: TaskPlanningSnapshot) => void;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      {loading && tasks.length === 0 ? (
        <div className="p-5 text-text-muted text-sm">{LOADING_TASKS_TEXT}</div>
      ) : tasks.length === 0 ? (
        <div className="p-5 text-text-muted text-sm">{EMPTY_TASKS_TEXT}</div>
      ) : (
        tasks.map((snapshot) => (
          <TaskListItem
            key={snapshot.task.taskId}
            snapshot={snapshot}
            selected={selectedTaskId === snapshot.task.taskId}
            onSelect={onSelect}
          />
        ))
      )}
    </div>
  );
}

function TaskListItem({
  snapshot,
  selected,
  onSelect,
}: {
  snapshot: TaskPlanningSnapshot;
  selected: boolean;
  onSelect: (snapshot: TaskPlanningSnapshot) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(snapshot)}
      className={`w-full text-left px-4 md:px-5 py-2.5 border-b border-white/5 hover:bg-white/5 transition-colors ${
        selected ? 'bg-white/10' : 'bg-transparent'
      }`}
    >
      <div className="flex items-center justify-between gap-3 min-w-0">
        <div className="min-w-0 flex-1 font-medium text-sm truncate">
          {snapshot.task.seq != null && (
            <span className="text-text-muted mr-1">
              {TASK_SEQ_PREFIX}
              {snapshot.task.seq}
            </span>
          )}
          {snapshot.task.title}
        </div>
        <div className="shrink-0 whitespace-nowrap">
          <TaskStatusBadge snapshot={snapshot} />
        </div>
      </div>
    </button>
  );
}

function TaskListHeader({
  draft,
  repositories,
  selectedRepository,
  repositoriesRefreshing,
  error,
  isNewTaskOpen,
  onDraftChange,
  onRefreshRepositories,
  onNewTask,
}: {
  draft: DraftTaskInput;
  repositories: RepositoryOption[];
  selectedRepository?: RepositoryOption;
  repositoriesRefreshing: boolean;
  error: string | null;
  isNewTaskOpen: boolean;
  onDraftChange: (key: keyof DraftTaskInput, value: string) => void;
  onRefreshRepositories: () => void;
  onNewTask: () => void;
}) {
  return (
    <div className="px-4 py-3 border-b border-border-color flex items-start gap-2">
      <RepositoryControls
        draft={draft}
        repositories={repositories}
        selectedRepository={selectedRepository}
        repositoriesRefreshing={repositoriesRefreshing}
        error={error}
        onDraftChange={onDraftChange}
        onRefreshRepositories={onRefreshRepositories}
      />
      <PopupTooltip label="新任务">
        <button
          type="button"
          aria-label="新任务"
          onClick={onNewTask}
          className={`shrink-0 h-9 w-9 rounded-lg text-lg leading-none font-semibold border transition-colors ${
            isNewTaskOpen
              ? 'bg-brand text-white border-brand'
              : 'border-border-color text-text-secondary hover:bg-white/5'
          }`}
        >
          {NEW_TASK_ICON}
        </button>
      </PopupTooltip>
    </div>
  );
}
