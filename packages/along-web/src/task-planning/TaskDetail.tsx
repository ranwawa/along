import {
  type FormEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import type {
  TaskArtifactRecord,
  TaskFlowAction,
  TaskFlowSnapshot,
  TaskPlanningSnapshot,
} from '../types';
import { AgentStagesPanel } from './AgentStagesPanel';
import type { DraftTaskInput, RepositoryOption } from './api';
import {
  formatTime,
  getFlowActionClass,
  getTaskStatusLabel,
  getThreadStatusLabel,
} from './format';
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

function getMessageActions(flow: TaskFlowSnapshot) {
  const submitFeedbackAction = flow.actions.find(
    (action) => action.id === 'submit_feedback',
  );
  const requestRevisionAction = flow.actions.find(
    (action) => action.id === 'request_revision',
  );
  const requestChangesAction = flow.actions.find(
    (action) => action.id === 'request_changes',
  );
  return requestChangesAction?.enabled
    ? [requestChangesAction]
    : [submitFeedbackAction, requestRevisionAction].filter(
        (action): action is TaskFlowAction => Boolean(action),
      );
}

function ExistingTaskComposer({
  flow,
  messageBody,
  busyAction,
  onMessageChange,
  onSubmitMessage,
}: {
  flow: TaskFlowSnapshot;
  messageBody: string;
  busyAction: string | null;
  onMessageChange: (value: string) => void;
  onSubmitMessage: () => void;
}) {
  const messageActions = getMessageActions(flow);
  const canSubmitMessage = messageActions.some((action) => action.enabled);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmitMessage();
      }}
      className="rounded-lg border border-border-color bg-black/25 p-4 flex flex-col gap-3"
    >
      <div className="text-sm font-semibold text-text-secondary">继续输入</div>
      <textarea
        value={messageBody}
        onChange={(event) => onMessageChange(event.target.value)}
        placeholder="补充反馈、继续提问或说明交付后的修改要求"
        rows={5}
        disabled={!canSubmitMessage}
        className="bg-black/35 border border-border-color rounded-lg px-3 py-2 text-sm outline-none resize-none focus:ring-1 focus:ring-brand/60 disabled:opacity-50"
      />
      <div className="flex flex-wrap gap-2">
        {messageActions.map((action) => (
          <button
            key={action.id}
            type="submit"
            disabled={
              !action.enabled || !messageBody.trim() || Boolean(busyAction)
            }
            title={!action.enabled ? action.disabledReason : action.description}
            className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${getFlowActionClass(
              action,
            )}`}
          >
            {busyAction === 'message' ? '发送中' : action.label}
          </button>
        ))}
      </div>
    </form>
  );
}

function NewTaskComposer({
  draft,
  selectedRepository,
  busyAction,
  onDraftChange,
  onCreateTask,
}: {
  draft: DraftTaskInput;
  selectedRepository?: RepositoryOption;
  busyAction: string | null;
  onDraftChange: (key: keyof DraftTaskInput, value: string) => void;
  onCreateTask: (event: FormEvent) => void;
}) {
  return (
    <form
      onSubmit={onCreateTask}
      className="rounded-lg border border-border-color bg-black/25 p-4 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-text-secondary">
          继续输入
        </div>
        {selectedRepository && (
          <span className="text-xs text-text-muted truncate">
            {selectedRepository.fullName}
          </span>
        )}
      </div>
      <textarea
        value={draft.body}
        onChange={(event) => onDraftChange('body', event.target.value)}
        placeholder="输入任务目标或问题"
        rows={6}
        className="bg-black/35 border border-border-color rounded-lg px-3 py-2 text-sm outline-none resize-none focus:ring-1 focus:ring-brand/60"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-xs text-text-muted">
          {selectedRepository ? '将创建到当前仓库。' : '请先选择仓库。'}
        </span>
        <button
          type="submit"
          disabled={
            !selectedRepository || !draft.body.trim() || busyAction === 'create'
          }
          className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold bg-brand text-white border border-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {busyAction === 'create' ? '发送中' : '发送'}
        </button>
      </div>
    </form>
  );
}

function scrollToLatest(element: HTMLDivElement | null) {
  if (!element) return;
  element.scrollTop = element.scrollHeight;
}

type TaskDetailProps = {
  selected: TaskPlanningSnapshot | null;
  isNewTaskOpen: boolean;
  draft: DraftTaskInput;
  selectedRepository?: RepositoryOption;
  sortedArtifacts: TaskArtifactRecord[];
  messageBody: string;
  busyAction: string | null;
  onDraftChange: (key: keyof DraftTaskInput, value: string) => void;
  onCreateTask: (event: FormEvent) => void;
  onMessageChange: (value: string) => void;
  onSubmitMessage: () => void;
  onAction: (action: TaskFlowAction) => void;
};

function useLatestScroll(detailKey: string, artifactCount: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldFollowLatestRef = useRef(true);
  const onScroll = (element: HTMLDivElement) => {
    shouldFollowLatestRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 96;
  };

  useLayoutEffect(() => {
    void detailKey;
    shouldFollowLatestRef.current = true;
    scrollToLatest(scrollRef.current);
  }, [detailKey]);

  useEffect(() => {
    void artifactCount;
    if (shouldFollowLatestRef.current) scrollToLatest(scrollRef.current);
  }, [artifactCount]);

  return { scrollRef, onScroll };
}

export function TaskDetail(props: TaskDetailProps) {
  const detailKey =
    props.selected?.task.taskId || (props.isNewTaskOpen ? 'new' : 'empty');
  const { scrollRef, onScroll } = useLatestScroll(
    detailKey,
    props.sortedArtifacts.length,
  );

  if (!props.selected) {
    if (props.isNewTaskOpen) {
      return (
        <NewTaskDetail
          detail={props}
          scrollRef={scrollRef}
          onScroll={onScroll}
        />
      );
    }
    return <EmptyTaskDetail />;
  }

  return (
    <SelectedTaskDetail
      detail={props}
      selected={props.selected}
      scrollRef={scrollRef}
      onScroll={onScroll}
    />
  );
}

function EmptyTaskDetail() {
  return (
    <div className="flex-1 min-h-[320px] flex items-center justify-center text-text-muted text-sm">
      请选择任务，或点击新任务。
    </div>
  );
}

function NewTaskDetail({
  detail,
  scrollRef,
  onScroll,
}: {
  detail: TaskDetailProps;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: (element: HTMLDivElement) => void;
}) {
  return (
    <>
      <div className="shrink-0 p-4 md:p-6 border-b border-border-color flex flex-col gap-2">
        <div className="text-xs text-text-muted">新任务会话</div>
        <h2 className="text-lg md:text-xl font-semibold">新任务</h2>
      </div>
      <div
        ref={scrollRef}
        onScroll={(event) => onScroll(event.currentTarget)}
        className="flex-1 min-h-0 overflow-auto p-4 md:p-6"
      >
        <TaskRecordsPanel artifacts={[]}>
          <NewTaskComposer
            draft={detail.draft}
            selectedRepository={detail.selectedRepository}
            busyAction={detail.busyAction}
            onDraftChange={detail.onDraftChange}
            onCreateTask={detail.onCreateTask}
          />
        </TaskRecordsPanel>
      </div>
    </>
  );
}

function SelectedTaskDetail({
  detail,
  selected,
  scrollRef,
  onScroll,
}: {
  detail: TaskDetailProps;
  selected: TaskPlanningSnapshot;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: (element: HTMLDivElement) => void;
}) {
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

      <div
        ref={scrollRef}
        onScroll={(event) => onScroll(event.currentTarget)}
        className="flex-1 min-h-0 overflow-auto p-4 md:p-6 grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_360px] gap-5"
      >
        <div className="min-w-0 flex flex-col gap-5">
          <TaskFlowPanel
            flow={selected.flow}
            busyAction={detail.busyAction}
            onAction={detail.onAction}
          />
          <CurrentPlanPanel selected={selected} />
          <TaskProgressPanel snapshot={selected} />
          <AgentStagesPanel stages={selected.agentStages || []} />
          <TaskRecordsPanel artifacts={detail.sortedArtifacts}>
            <ExistingTaskComposer
              flow={selected.flow}
              messageBody={detail.messageBody}
              busyAction={detail.busyAction}
              onMessageChange={detail.onMessageChange}
              onSubmitMessage={detail.onSubmitMessage}
            />
          </TaskRecordsPanel>
        </div>
        <TaskInfoPanel selected={selected} />
      </div>
    </>
  );
}
