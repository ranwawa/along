import {
  Activity,
  History,
  Info,
  type LucideIcon,
  TerminalSquare,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Sheet, SheetContent } from '../components/ui/sheet';
import type { TaskPlanningSnapshot } from '../types';
import { formatTime, getTaskStatusLabel, getThreadStatusLabel } from './format';
import { FlowHistory } from './TaskFlowPanel';
import { TaskProgressEventsView } from './TaskProgressPanel';
import { TaskSessionTailView } from './TaskSessionTailView';

const LABELS = {
  panelTitle: '任务面板',
  progress: '实时进展',
  tail: 'Agent 会话 Tail',
  metadata: '任务元信息',
  history: '历史流转',
  modeAutonomous: '自动模式',
  modeManual: '人工确认',
  fieldId: 'ID',
  fieldSeq: 'Seq',
  fieldType: 'Type',
  fieldThread: 'Thread',
  fieldPlanStatus: 'Plan Status',
  fieldWorkflow: 'Workflow',
  fieldSource: 'Source',
  fieldMode: 'Mode',
  fieldStatus: 'Status',
  fieldBranch: 'Branch',
  fieldWorktree: 'Worktree',
  fieldPr: 'PR',
  fieldUpdated: 'Updated',
} as const;

export type TaskDetailDialogKind = 'progress' | 'tail' | 'metadata' | 'history';

const TASK_DETAIL_ACTIONS: {
  kind: TaskDetailDialogKind;
  label: string;
  icon: LucideIcon;
}[] = [
  { kind: 'progress', label: LABELS.progress, icon: Activity },
  { kind: 'tail', label: LABELS.tail, icon: TerminalSquare },
  { kind: 'metadata', label: LABELS.metadata, icon: Info },
  { kind: 'history', label: LABELS.history, icon: History },
];

const DIALOG_DEFAULT_WIDTH = 320;
const DIALOG_MIN_WIDTH = 280;
const DIALOG_MAX_WIDTH = 560;

const TASK_DETAIL_DIALOG_WIDTH = {
  defaultWidth: DIALOG_DEFAULT_WIDTH,
  minWidth: DIALOG_MIN_WIDTH,
  maxWidth: DIALOG_MAX_WIDTH,
  minMainWidth: DIALOG_MIN_WIDTH,
};

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
    selected.task.executionMode === 'autonomous'
      ? LABELS.modeAutonomous
      : LABELS.modeManual;
  return (
    <div className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-2 px-4 pb-4 text-sm">
      <span className="text-text-muted">{LABELS.fieldId}</span>
      <span className="truncate">{selected.task.taskId}</span>
      {selected.task.seq != null && (
        <>
          <span className="text-text-muted">{LABELS.fieldSeq}</span>
          <span>{`#${selected.task.seq}`}</span>
        </>
      )}
      {selected.task.type && (
        <>
          <span className="text-text-muted">{LABELS.fieldType}</span>
          <span>{selected.task.type}</span>
        </>
      )}
      <span className="text-text-muted">{LABELS.fieldThread}</span>
      <span className="truncate">{selected.thread.threadId}</span>
      <span className="text-text-muted">{LABELS.fieldPlanStatus}</span>
      <span>{getThreadStatusLabel(selected.thread.status)}</span>
      <span className="text-text-muted">{LABELS.fieldWorkflow}</span>
      <span>{selected.task.currentWorkflowKind}</span>
      <span className="text-text-muted">{LABELS.fieldSource}</span>
      <span>{selected.task.source}</span>
      <span className="text-text-muted">{LABELS.fieldMode}</span>
      <span>{executionMode}</span>
      <span className="text-text-muted">{LABELS.fieldStatus}</span>
      <span>{statusLabel}</span>
      <TaskInfoOptionalRows selected={selected} />
      <span className="text-text-muted">{LABELS.fieldUpdated}</span>
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
          <span className="text-text-muted">{LABELS.fieldBranch}</span>
          <span className="truncate">{selected.task.branchName}</span>
        </>
      )}
      {selected.task.worktreePath && (
        <>
          <span className="text-text-muted">{LABELS.fieldWorktree}</span>
          <span className="truncate" title={selected.task.worktreePath}>
            {selected.task.worktreePath}
          </span>
        </>
      )}
      {selected.task.prUrl && (
        <>
          <span className="text-text-muted">{LABELS.fieldPr}</span>
          <a
            href={selected.task.prUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate text-brand hover:text-brand-hover"
          >
            {`#${selected.task.prNumber || selected.task.prUrl}`}
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
          {LABELS.panelTitle}
        </div>
        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:justify-end sm:overflow-visible sm:pb-0">
          {TASK_DETAIL_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Button
                key={action.kind}
                type="button"
                onClick={() => onOpenDialog(action.kind)}
                size="sm"
                className="gap-1.5 bg-black/20"
              >
                <Icon aria-hidden="true" className="h-4 w-4" />
                {action.label}
              </Button>
            );
          })}
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
    return <TaskSessionTailView snapshot={selected} chrome={false} />;
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
  if (!kind) return null;

  const title = getTaskDialogTitle(kind);

  return (
    <Sheet
      modal={false}
      open={Boolean(kind)}
      onOpenChange={(open) => !open && onClose()}
    >
      <SheetContent
        title={title}
        showOverlay={false}
        resizable={TASK_DETAIL_DIALOG_WIDTH}
        className="animate-[slideInRight_0.22s_cubic-bezier(0.16,1,0.3,1)]"
      >
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <TaskDetailDialogContent kind={kind} selected={selected} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
