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
  TaskPlanningSnapshot,
} from '../types';
import { AgentStagesPanel } from './AgentStagesPanel';
import type { DraftTaskInput, RepositoryOption } from './api';
import { ExistingTaskComposer } from './ExistingTaskComposer';
import { formatTime, getTaskStatusLabel, getThreadStatusLabel } from './format';
import { FlowHistory, TaskFlowPanel } from './TaskFlowPanel';
import { ImageAttachmentPicker } from './TaskImageAttachments';
import { TaskProgressPanel } from './TaskProgressPanel';
import { TaskRecordsPanel } from './TaskRecords';

function TaskInfoPanel({ selected }: { selected: TaskPlanningSnapshot }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const executionMode =
    selected.task.executionMode === 'autonomous' ? '全自动' : '人工确认';
  return (
    <aside className="min-w-0 rounded-lg border border-border-color bg-black/25">
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((value) => !value)}
        className="w-full px-4 py-3 text-left outline-none focus:ring-1 focus:ring-brand/60"
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2">
            <span className="text-sm font-semibold text-text-secondary">
              任务元信息
            </span>
            {!isExpanded && (
              <span className="truncate text-xs text-text-muted">
                {getTaskStatusLabel(selected.task.status)} ·{' '}
                {formatTime(selected.task.updatedAt)}
              </span>
            )}
          </div>
          <span className="shrink-0 text-xs text-text-muted">
            {isExpanded ? '收起' : '展开'}
          </span>
        </div>
      </button>
      {isExpanded && (
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
          <span className="text-text-muted">Source</span>
          <span>{selected.task.source}</span>
          <span className="text-text-muted">Mode</span>
          <span>{executionMode}</span>
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
      )}
    </aside>
  );
}

function NewTaskComposer({
  draft,
  selectedRepository,
  busyAction,
  onDraftChange,
  onDraftAttachmentsChange,
  onCreateTask,
}: {
  draft: DraftTaskInput;
  selectedRepository?: RepositoryOption;
  busyAction: string | null;
  onDraftChange: (key: keyof DraftTaskInput, value: string) => void;
  onDraftAttachmentsChange: (files: File[]) => void;
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
      <ImageAttachmentPicker
        attachments={draft.attachments}
        onChange={onDraftAttachmentsChange}
      />
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        执行模式
        <select
          value={draft.executionMode}
          onChange={(event) =>
            onDraftChange('executionMode', event.target.value)
          }
          className="bg-black/35 border border-border-color rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:ring-1 focus:ring-brand/60"
        >
          <option value="manual">人工确认</option>
          <option value="autonomous">全自动</option>
        </select>
      </label>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-xs text-text-muted">
          {selectedRepository ? '将创建到当前仓库。' : '请先选择仓库。'}
        </span>
        <button
          type="submit"
          disabled={
            !selectedRepository ||
            (!draft.body.trim() && draft.attachments.length === 0) ||
            busyAction === 'create'
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
  messageAttachments: File[];
  busyAction: string | null;
  onDraftChange: (key: keyof DraftTaskInput, value: string) => void;
  onDraftAttachmentsChange: (files: File[]) => void;
  onCreateTask: (event: FormEvent) => void;
  onMessageChange: (value: string) => void;
  onMessageAttachmentsChange: (files: File[]) => void;
  onSubmitMessage: () => void;
  onAction: (action: TaskFlowAction) => void;
};

function useLatestScroll(detailKey: string, activityCount: number) {
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
    void activityCount;
    if (shouldFollowLatestRef.current) scrollToLatest(scrollRef.current);
  }, [activityCount]);

  return { scrollRef, onScroll };
}

export function TaskDetail(props: TaskDetailProps) {
  const detailKey =
    props.selected?.task.taskId || (props.isNewTaskOpen ? 'new' : 'empty');
  const activityCount =
    props.sortedArtifacts.length +
    (props.selected?.agentProgressEvents.length || 0) +
    (props.selected?.agentSessionEvents.length || 0);
  const { scrollRef, onScroll } = useLatestScroll(detailKey, activityCount);

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
          onDraftAttachmentsChange={detail.onDraftAttachmentsChange}
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
            <TaskProgressPanel snapshot={selected} />
            <AgentStagesPanel stages={selected.agentStages || []} />
            <TaskRecordsPanel artifacts={detail.sortedArtifacts} />
          </div>
        </div>
        <div className="shrink-0 border-t border-border-color bg-bg-secondary p-3 md:p-4">
          <ExistingTaskComposer
            flow={selected.flow}
            messageBody={detail.messageBody}
            attachments={detail.messageAttachments}
            busyAction={detail.busyAction}
            onMessageChange={detail.onMessageChange}
            onAttachmentsChange={detail.onMessageAttachmentsChange}
            onSubmitMessage={detail.onSubmitMessage}
          />
        </div>
      </section>
      <aside className="min-h-0 min-w-0 overflow-hidden border-t border-border-color 2xl:border-l 2xl:border-t-0">
        <div className="flex h-full min-w-0 flex-col">
          <div className="shrink-0 p-4 pb-3 md:p-5 md:pb-3">
            <TaskInfoPanel selected={selected} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-4 md:px-5 md:pb-5">
            <TaskFlowPanel
              flow={selected.flow}
              currentPlan={selected.currentPlan}
              busyAction={detail.busyAction}
              onAction={detail.onAction}
            />
          </div>
          <div className="max-h-[45%] shrink-0 overflow-auto border-t border-border-color bg-bg-secondary p-4 md:p-5">
            <FlowHistory flow={selected.flow} />
          </div>
        </div>
      </aside>
    </div>
  );
}
