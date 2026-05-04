import {
  type FormEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
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
          任务元信息
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

function TaskBodyPanel({ selected }: { selected: TaskPlanningSnapshot }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const body = selected.task.body.trim();
  const bodyText = body || '暂无任务详情。';
  const collapsedText = body ? body.replace(/\s+/g, ' ') : bodyText;

  return (
    <section className="rounded-lg border border-border-color bg-black/25">
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((value) => !value)}
        className="w-full min-w-0 px-4 py-3 text-left outline-none focus:ring-1 focus:ring-brand/60"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 text-sm font-semibold text-text-secondary">
            任务详情
          </span>
          {!isExpanded && (
            <span
              className="min-w-0 flex-1 truncate text-sm text-text-primary"
              title={collapsedText}
            >
              {collapsedText}
            </span>
          )}
          <span className="ml-auto shrink-0 text-xs text-text-muted">
            {isExpanded ? '收起' : '展开'}
          </span>
        </div>
        {isExpanded && (
          <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-text-primary">
            {bodyText}
          </div>
        )}
      </button>
    </section>
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
      className="flex flex-col gap-3"
    >
      <textarea
        value={messageBody}
        onChange={(event) => onMessageChange(event.target.value)}
        placeholder="补充反馈、继续提问或说明交付后的修改要求"
        rows={2}
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
    <form onSubmit={onCreateTask} className="flex flex-col gap-3">
      <div className="text-sm font-semibold text-text-secondary">任务内容</div>
      <textarea
        value={draft.body}
        onChange={(event) => onDraftChange('body', event.target.value)}
        placeholder="输入任务目标或问题"
        rows={2}
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
    <div className="flex-1 min-h-0 flex flex-col">
      <div
        ref={scrollRef}
        onScroll={(event) => onScroll(event.currentTarget)}
        className="flex-1 min-h-0 overflow-auto"
      />
      <div className="shrink-0 border-t border-border-color bg-bg-secondary p-4 md:p-5">
        <NewTaskComposer
          draft={detail.draft}
          selectedRepository={detail.selectedRepository}
          busyAction={detail.busyAction}
          onDraftChange={detail.onDraftChange}
          onCreateTask={detail.onCreateTask}
        />
      </div>
    </div>
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
    <div className="flex-1 min-h-0 grid grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(260px,40vh)] 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-rows-1">
      <section className="min-h-0 min-w-0 flex flex-col">
        <div
          ref={scrollRef}
          onScroll={(event) => onScroll(event.currentTarget)}
          className="flex-1 min-h-0 overflow-auto p-4 md:p-6"
        >
          <div className="min-w-0 flex flex-col gap-5">
            <CurrentPlanPanel selected={selected} />
            <TaskProgressPanel snapshot={selected} />
            <AgentStagesPanel stages={selected.agentStages || []} />
            <TaskRecordsPanel artifacts={detail.sortedArtifacts} />
          </div>
        </div>
        <div className="shrink-0 border-t border-border-color bg-bg-secondary p-3 md:p-4">
          <ExistingTaskComposer
            flow={selected.flow}
            messageBody={detail.messageBody}
            busyAction={detail.busyAction}
            onMessageChange={detail.onMessageChange}
            onSubmitMessage={detail.onSubmitMessage}
          />
        </div>
      </section>
      <div className="min-h-0 min-w-0 overflow-auto border-t border-border-color p-4 md:p-6 2xl:border-l 2xl:border-t-0">
        <div className="flex min-w-0 flex-col gap-4">
          <TaskBodyPanel selected={selected} />
          <TaskFlowPanel
            flow={selected.flow}
            busyAction={detail.busyAction}
            onAction={detail.onAction}
          />
          <TaskInfoPanel selected={selected} />
        </div>
      </div>
    </div>
  );
}
