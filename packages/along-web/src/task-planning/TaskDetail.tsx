import type {
  TaskArtifactRecord,
  TaskFlowAction,
  TaskPlanningSnapshot,
} from '../types';
import { AgentStagesPanel } from './AgentStagesPanel';
import { formatTime, getTaskStatusLabel, getThreadStatusLabel } from './format';
import { TaskFlowPanel } from './TaskFlowPanel';
import { TaskProgressPanel } from './TaskProgressPanel';
import { TaskRecordsPanel } from './TaskRecords';
import { TaskStatusBadge } from './TaskStatusBadge';

function CurrentPlanPanel({ selected }: { selected: TaskPlanningSnapshot }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-secondary">当前方案</h3>
        {selected.openRound && (
          <span className="text-xs text-amber-300">等待重新规划</span>
        )}
      </div>
      <div className="rounded-lg border border-border-color bg-black/35 p-4 min-h-[180px]">
        {selected.currentPlan ? (
          <div className="whitespace-pre-wrap break-words text-sm leading-6">
            {selected.currentPlan.body}
          </div>
        ) : (
          <div className="text-sm text-text-muted">等待 Planner 输出。</div>
        )}
      </div>
    </section>
  );
}

function TaskInfoPanel({ selected }: { selected: TaskPlanningSnapshot }) {
  return (
    <aside className="min-w-0 flex flex-col gap-4">
      <div className="rounded-lg border border-border-color bg-black/25 p-4 flex flex-col gap-3">
        <div className="font-semibold text-sm text-text-secondary">
          任务信息
        </div>
        <div className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-2 text-sm">
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
          <span className="text-text-muted">Source</span>
          <span>{selected.task.source}</span>
          <span className="text-text-muted">Status</span>
          <span>{getTaskStatusLabel(selected.task.status)}</span>
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
          <span className="text-text-muted">Updated</span>
          <span>{formatTime(selected.task.updatedAt)}</span>
        </div>
      </div>
    </aside>
  );
}

export function TaskDetail({
  selected,
  sortedArtifacts,
  messageBody,
  busyAction,
  onMessageChange,
  onSubmitMessage,
  onAction,
}: {
  selected: TaskPlanningSnapshot | null;
  sortedArtifacts: TaskArtifactRecord[];
  messageBody: string;
  busyAction: string | null;
  onMessageChange: (value: string) => void;
  onSubmitMessage: () => void;
  onAction: (action: TaskFlowAction) => void;
}) {
  if (!selected) {
    return (
      <div className="flex-1 min-h-[320px] flex items-center justify-center text-text-muted text-sm">
        请选择任务。
      </div>
    );
  }

  return (
    <>
      <div className="shrink-0 p-4 md:p-6 border-b border-border-color flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <TaskStatusBadge snapshot={selected} />
              {selected.task.type && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-500/15 text-violet-300 border border-violet-500/30">
                  {selected.task.type}
                </span>
              )}
              <span className="text-xs text-text-muted">
                v{selected.currentPlan?.version || 0}
              </span>
            </div>
            <h2 className="text-lg md:text-xl font-semibold truncate">
              {selected.task.seq != null && (
                <span className="text-text-muted mr-1">
                  #{selected.task.seq}
                </span>
              )}
              {selected.task.title}
            </h2>
          </div>
          <div className="shrink-0 text-right text-xs text-text-muted">
            <div>{formatTime(selected.task.updatedAt)}</div>
            <div>{getTaskStatusLabel(selected.task.status)}</div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4 md:p-6 grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
        <div className="min-w-0 flex flex-col gap-5">
          <TaskFlowPanel
            flow={selected.flow}
            messageBody={messageBody}
            busyAction={busyAction}
            onMessageChange={onMessageChange}
            onSubmitMessage={onSubmitMessage}
            onAction={onAction}
          />
          <CurrentPlanPanel selected={selected} />
          <TaskProgressPanel snapshot={selected} />
          <AgentStagesPanel stages={selected.agentStages || []} />
          <TaskRecordsPanel artifacts={sortedArtifacts} />
        </div>
        <TaskInfoPanel selected={selected} />
      </div>
    </>
  );
}
