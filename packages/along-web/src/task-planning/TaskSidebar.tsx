import { Plus, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import type { TaskPlanningSnapshot } from '../types';
import type { DraftTaskInput, RepositoryOption } from './api';
import { TaskStatusBadge } from './TaskStatusBadge';
import { getLatestFailedAgentStage } from './taskAgentFailure';

const EMPTY_REPOSITORY_LABEL = '暂无已注册仓库';
const LOADING_TASKS_TEXT = '加载中...';
const EMPTY_TASKS_TEXT = '暂无任务。';
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
  onDelete,
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
  onDelete: (taskId: string) => void;
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
        onDelete={onDelete}
      />
    </>
  );
}

function TaskListContent({
  tasks,
  loading,
  selectedTaskId,
  onSelect,
  onDelete,
}: {
  tasks: TaskPlanningSnapshot[];
  loading: boolean;
  selectedTaskId?: string;
  onSelect: (snapshot: TaskPlanningSnapshot) => void;
  onDelete: (taskId: string) => void;
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
            onDelete={onDelete}
          />
        ))
      )}
    </div>
  );
}

function DeleteConfirmPopover({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="删除任务"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/10 text-text-muted hover:text-red-400"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="center" className="w-auto p-3">
        <p className="text-xs text-text-secondary mb-2">
          确认删除此任务及所有相关数据？
        </p>
        <div className="flex gap-2 justify-end">
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          >
            取消
          </Button>
          <Button
            type="button"
            size="xs"
            variant="destructive"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onConfirm();
            }}
          >
            删除
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TaskListItem({
  snapshot,
  selected,
  onSelect,
  onDelete,
}: {
  snapshot: TaskPlanningSnapshot;
  selected: boolean;
  onSelect: (snapshot: TaskPlanningSnapshot) => void;
  onDelete: (taskId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(snapshot)}
      className={`group w-full text-left px-4 md:px-5 py-2.5 border-b border-white/5 hover:bg-white/5 transition-colors ${
        selected ? 'bg-white/10' : 'bg-transparent'
      }`}
    >
      <div className="flex items-center justify-between gap-3 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <DeleteConfirmPopover
            onConfirm={() => onDelete(snapshot.task.taskId)}
          />
          <span className="min-w-0 flex-1 font-medium text-sm truncate">
            {snapshot.task.seq != null && (
              <span className="text-text-muted mr-1">
                {TASK_SEQ_PREFIX}
                {snapshot.task.seq}
              </span>
            )}
            {snapshot.task.title}
          </span>
        </div>
        <div className="shrink-0 whitespace-nowrap">
          <TaskStatusBadge
            snapshot={snapshot}
            failed={Boolean(getLatestFailedAgentStage(snapshot.agentStages))}
          />
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
          <Plus aria-hidden="true" className="h-4 w-4" />
        </Button>
      </PopupTooltip>
    </div>
  );
}
