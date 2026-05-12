import type { ReactNode } from 'react';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/input';
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
  error,
  onDraftChange,
}: {
  draft: DraftTaskInput;
  repositories: RepositoryOption[];
  error: string | null;
  onDraftChange: (key: keyof DraftTaskInput, value: string) => void;
}) {
  return (
    <div className="min-w-0 flex-1 flex flex-col gap-2">
      <Select
        aria-label="仓库"
        value={draft.repository}
        onChange={(event) => onDraftChange('repository', event.target.value)}
        className="w-full bg-black/30"
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
      </Select>
      {error && <Alert variant="error">{error}</Alert>}
    </div>
  );
}

export function TaskListPanel({
  draft,
  repositories,
  error,
  tasks,
  loading,
  selectedTaskId,
  isNewTaskOpen,
  onDraftChange,
  onNewTask,
  onSelect,
}: {
  draft: DraftTaskInput;
  repositories: RepositoryOption[];
  error: string | null;
  tasks: TaskPlanningSnapshot[];
  loading: boolean;
  selectedTaskId?: string;
  isNewTaskOpen: boolean;
  onDraftChange: (key: keyof DraftTaskInput, value: string) => void;
  onNewTask: () => void;
  onSelect: (snapshot: TaskPlanningSnapshot) => void;
}) {
  return (
    <>
      <TaskListHeader
        draft={draft}
        repositories={repositories}
        error={error}
        isNewTaskOpen={isNewTaskOpen}
        onDraftChange={onDraftChange}
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
  error,
  isNewTaskOpen,
  onDraftChange,
  onNewTask,
}: {
  draft: DraftTaskInput;
  repositories: RepositoryOption[];
  error: string | null;
  isNewTaskOpen: boolean;
  onDraftChange: (key: keyof DraftTaskInput, value: string) => void;
  onNewTask: () => void;
}) {
  return (
    <div className="px-4 py-3 border-b border-border-color flex items-start gap-2">
      <RepositoryControls
        draft={draft}
        repositories={repositories}
        error={error}
        onDraftChange={onDraftChange}
      />
      <PopupTooltip label="新任务">
        <Button
          type="button"
          aria-label="新任务"
          onClick={onNewTask}
          variant={isNewTaskOpen ? 'default' : 'outline'}
          size="icon"
          className={`h-9 w-9 text-lg leading-none ${
            isNewTaskOpen
              ? ''
              : 'border-border-color text-text-secondary hover:bg-white/5'
          }`}
        >
          {NEW_TASK_ICON}
        </Button>
      </PopupTooltip>
    </div>
  );
}
