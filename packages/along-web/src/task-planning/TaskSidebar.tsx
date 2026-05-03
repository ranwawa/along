import type { FormEvent } from 'react';
import type { TaskPlanningSnapshot } from '../types';
import type { DraftTaskInput, RepositoryOption } from './api';
import { formatTime, getLatestFailedStage } from './format';
import { TaskStatusBadge } from './TaskStatusBadge';

export function NewTaskForm({
  draft,
  repositories,
  selectedRepository,
  busyAction,
  repositoriesRefreshing,
  error,
  onSubmit,
  onDraftChange,
  onRefreshRepositories,
}: {
  draft: DraftTaskInput;
  repositories: RepositoryOption[];
  selectedRepository?: RepositoryOption;
  busyAction: string | null;
  repositoriesRefreshing: boolean;
  error: string | null;
  onSubmit: (event: FormEvent) => void;
  onDraftChange: (key: keyof DraftTaskInput, value: string) => void;
  onRefreshRepositories: () => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="shrink-0 p-4 md:p-5 border-b border-border-color flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold text-sm md:text-base">新任务</div>
        <button
          type="submit"
          disabled={!draft.body.trim() || busyAction === 'create'}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand text-white border border-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {busyAction === 'create' ? '处理中' : '发送'}
        </button>
      </div>
      <input
        type="text"
        value={draft.title}
        onChange={(event) => onDraftChange('title', event.target.value)}
        placeholder="标题"
        className="bg-black/30 border border-border-color rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand/60"
      />
      <textarea
        value={draft.body}
        onChange={(event) => onDraftChange('body', event.target.value)}
        placeholder="输入任务目标或问题"
        rows={5}
        className="bg-black/30 border border-border-color rounded-lg px-3 py-2 text-sm outline-none resize-none focus:ring-1 focus:ring-brand/60"
      />
      <div className="flex gap-2">
        <select
          value={draft.repository}
          onChange={(event) => onDraftChange('repository', event.target.value)}
          className="min-w-0 flex-1 bg-black/30 border border-border-color rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand/60"
        >
          {repositories.length === 0 ? (
            <option value="">当前默认项目</option>
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
        <div
          className="text-xs text-text-muted truncate"
          title={selectedRepository.path}
        >
          {selectedRepository.path}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
    </form>
  );
}

export function TaskListPanel({
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
    <>
      <div className="px-4 md:px-5 py-3 border-b border-border-color flex items-center justify-between">
        <span className="text-sm font-semibold">任务列表</span>
        <span className="text-xs text-text-muted">{tasks.length}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {loading && tasks.length === 0 ? (
          <div className="p-5 text-text-muted text-sm">加载中...</div>
        ) : tasks.length === 0 ? (
          <div className="p-5 text-text-muted text-sm">暂无任务。</div>
        ) : (
          tasks.map((snapshot) => {
            const failedStage = getLatestFailedStage(snapshot);
            return (
              <button
                type="button"
                key={snapshot.task.taskId}
                onClick={() => onSelect(snapshot)}
                className={`w-full text-left px-4 md:px-5 py-4 border-b border-white/5 hover:bg-white/5 transition-colors ${
                  selectedTaskId === snapshot.task.taskId
                    ? 'bg-white/10'
                    : 'bg-transparent'
                }`}
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <TaskStatusBadge snapshot={snapshot} />
                    {failedStage && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border bg-rose-500/15 text-rose-300 border-rose-500/30">
                        {failedStage.label}失败
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-text-muted shrink-0">
                    {formatTime(snapshot.task.updatedAt)}
                  </span>
                </div>
                <div className="font-medium text-sm truncate">
                  {snapshot.task.seq != null && (
                    <span className="text-text-muted mr-1">
                      #{snapshot.task.seq}
                    </span>
                  )}
                  {snapshot.task.title}
                </div>
                <div className="text-xs text-text-muted truncate mt-1">
                  {failedStage?.latestRun?.error || snapshot.task.body}
                </div>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}
