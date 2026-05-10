// biome-ignore-all lint/style/noJsxLiterals: task planning panels use existing inline labels.
// biome-ignore-all lint/style/noMagicNumbers: task planning layout uses fixed UI thresholds.
import { useEffect } from 'react';
import type { TaskPlanningSnapshot } from '../types';
import { formatTime, getTaskStatusLabel, getThreadStatusLabel } from './format';
import { FlowHistory } from './TaskFlowPanel';
import { TaskProgressEventsView } from './TaskProgressPanel';
import { TaskSessionTailView } from './TaskSessionTailView';

export type TaskDetailDialogKind = 'progress' | 'tail' | 'metadata' | 'history';

const TASK_DETAIL_ACTIONS: {
  kind: TaskDetailDialogKind;
  label: string;
}[] = [
  { kind: 'progress', label: '实时进展' },
  { kind: 'tail', label: 'Agent 会话 Tail' },
  { kind: 'metadata', label: '任务元信息' },
  { kind: 'history', label: '历史流转' },
];

function getTaskDialogTitle(kind: TaskDetailDialogKind): string {
  return (
    TASK_DETAIL_ACTIONS.find((action) => action.kind === kind)?.label || ''
  );
}

function TaskInfoRows({
  selected,
  statusLabel,
}: {
  selected: TaskPlanningSnapshot;
  statusLabel: string;
}) {
  const executionMode =
    selected.task.executionMode === 'autonomous' ? '自动模式' : '人工确认';
  return (
    <div className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-2 px-4 pb-4 text-sm">
      <span className="text-text-muted">ID</span>
      <span className="truncate">{selected.task.taskId}</span>
      {selected.task.seq != null && (
        <>
          <span className="text-text-muted">Seq</span>
          <span>#{selected.task.seq}</span>
        </>
      )}
      {selected.task.type && (
        <>
          <span className="text-text-muted">Type</span>
          <span>{selected.task.type}</span>
        </>
      )}
      <span className="text-text-muted">Thread</span>
      <span className="truncate">{selected.thread.threadId}</span>
      <span className="text-text-muted">Plan Status</span>
      <span>{getThreadStatusLabel(selected.thread.status)}</span>
      <span className="text-text-muted">Workflow</span>
      <span>{selected.task.currentWorkflowKind}</span>
      <span className="text-text-muted">Source</span>
      <span>{selected.task.source}</span>
      <span className="text-text-muted">Mode</span>
      <span>{executionMode}</span>
      <span className="text-text-muted">Status</span>
      <span>{statusLabel}</span>
      <TaskInfoOptionalRows selected={selected} />
      <span className="text-text-muted">Updated</span>
      <span>{formatTime(selected.task.updatedAt)}</span>
    </div>
  );
}

function TaskInfoOptionalRows({
  selected,
}: {
  selected: TaskPlanningSnapshot;
}) {
  return (
    <>
      {selected.task.branchName && (
        <>
          <span className="text-text-muted">Branch</span>
          <span className="truncate">{selected.task.branchName}</span>
        </>
      )}
      {selected.task.worktreePath && (
        <>
          <span className="text-text-muted">Worktree</span>
          <span className="truncate" title={selected.task.worktreePath}>
            {selected.task.worktreePath}
          </span>
        </>
      )}
      {selected.task.prUrl && (
        <>
          <span className="text-text-muted">PR</span>
          <a
            href={selected.task.prUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate text-brand hover:text-brand-hover"
          >
            #{selected.task.prNumber || selected.task.prUrl}
          </a>
        </>
      )}
    </>
  );
}

export function TaskDetailHeader({
  onOpenDialog,
}: {
  onOpenDialog: (kind: TaskDetailDialogKind) => void;
}) {
  return (
    <div className="sticky top-0 z-20 border-b border-border-color bg-bg-secondary/95 px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur md:px-6">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-semibold text-text-secondary">
          任务面板
        </div>
        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:justify-end sm:overflow-visible sm:pb-0">
          {TASK_DETAIL_ACTIONS.map((action) => (
            <button
              key={action.kind}
              type="button"
              onClick={() => onOpenDialog(action.kind)}
              className="shrink-0 rounded-md border border-border-color bg-black/20 px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-white/5 focus:outline-none focus:ring-1 focus:ring-brand/60"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TaskDetailDialogContent({
  kind,
  selected,
}: {
  kind: TaskDetailDialogKind;
  selected: TaskPlanningSnapshot;
}) {
  if (kind === 'progress') {
    return <TaskProgressEventsView snapshot={selected} />;
  }

  if (kind === 'tail') {
    return <TaskSessionTailView snapshot={selected} />;
  }

  if (kind === 'metadata') {
    return (
      <section className="rounded-lg border border-border-color bg-black/20 pt-4">
        <TaskInfoRows
          selected={selected}
          statusLabel={
            selected.display?.label || getTaskStatusLabel(selected.task.status)
          }
        />
      </section>
    );
  }

  return <FlowHistory flow={selected.flow} defaultOpen={true} />;
}

export function TaskDetailDialog({
  kind,
  selected,
  onClose,
}: {
  kind: TaskDetailDialogKind | null;
  selected: TaskPlanningSnapshot;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!kind) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [kind, onClose]);

  if (!kind) return null;

  const title = getTaskDialogTitle(kind);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
    >
      <button
        type="button"
        aria-label="关闭弹框"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div className="relative flex max-h-[86vh] w-full max-w-4xl flex-col rounded-lg border border-border-color bg-bg-secondary shadow-xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-color px-4 py-3">
          <h3 className="min-w-0 truncate text-sm font-semibold text-text-secondary">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-border-color px-2 py-1 text-xs font-semibold text-text-secondary hover:bg-white/5"
          >
            关闭
          </button>
        </div>
        <div className="min-h-0 overflow-auto p-4">
          <TaskDetailDialogContent kind={kind} selected={selected} />
        </div>
      </div>
    </div>
  );
}
