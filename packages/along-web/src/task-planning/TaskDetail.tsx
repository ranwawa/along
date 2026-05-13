// biome-ignore-all lint/style/noJsxLiterals: existing dashboard view uses inline labels throughout.
// biome-ignore-all lint/style/noMagicNumbers: existing dashboard layout uses numeric UI thresholds.
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
  TaskExecutionMode,
  TaskFlowAction,
  TaskPlanningSnapshot,
  TaskRuntimeExecutionMode,
} from '../types';
import type { DraftTaskInput, RepositoryOption } from './api';
import { ExistingTaskComposer } from './ExistingTaskComposer';
import { TaskComposerInput } from './TaskComposerInput';
import {
  TaskDetailDialog,
  type TaskDetailDialogKind,
  TaskDetailHeader,
} from './TaskDetailPanels';
import { TaskFlowPanel } from './TaskFlowPanel';
import { TaskRecordsPanel } from './TaskRecords';
import { getTaskFailureSummary } from './taskAgentFailure';

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
  const hasDraft = Boolean(draft.body.trim()) || draft.attachments.length > 0;
  return (
    <TaskComposerInput
      attachments={draft.attachments}
      body={draft.body}
      busy={busyAction === 'create'}
      executionMode={draft.executionMode}
      runtimeExecutionMode={draft.runtimeExecutionMode}
      workspaceMode={draft.workspaceMode}
      placeholder={selectedRepository ? '输入任务目标或问题' : '请先选择仓库'}
      submitDisabled={!selectedRepository || !hasDraft || Boolean(busyAction)}
      submitTitle="创建任务"
      onAttachmentsChange={onDraftAttachmentsChange}
      onBodyChange={(value) => onDraftChange('body', value)}
      onExecutionModeChange={(value) => onDraftChange('executionMode', value)}
      onRuntimeExecutionModeChange={(value) =>
        onDraftChange('runtimeExecutionMode', value)
      }
      onWorkspaceModeChange={(value) => onDraftChange('workspaceMode', value)}
      onSubmit={onCreateTask}
    />
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
  messageExecutionMode: TaskExecutionMode;
  messageRuntimeExecutionMode: TaskRuntimeExecutionMode;
  busyAction: string | null;
  onDraftChange: (key: keyof DraftTaskInput, value: string) => void;
  onDraftAttachmentsChange: (files: File[]) => void;
  onCreateTask: (event: FormEvent) => void;
  onMessageChange: (value: string) => void;
  onMessageAttachmentsChange: (files: File[]) => void;
  onMessageExecutionModeChange: (value: TaskExecutionMode) => void;
  onMessageRuntimeExecutionModeChange: (
    value: TaskRuntimeExecutionMode,
  ) => void;
  onSubmitMessage: () => void;
  onCancelAgentRun: (runId?: string) => void;
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
  const [activeDialog, setActiveDialog] = useState<TaskDetailDialogKind | null>(
    null,
  );

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(260px,40vh)] 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-rows-1">
      <SelectedTaskMain
        detail={detail}
        selected={selected}
        scrollRef={scrollRef}
        onScroll={onScroll}
        onOpenDialog={setActiveDialog}
      />
      <SelectedTaskFlowAside detail={detail} selected={selected} />
      <TaskDetailDialog
        kind={activeDialog}
        selected={selected}
        onClose={() => setActiveDialog(null)}
      />
    </div>
  );
}

function SelectedTaskMain({
  detail,
  selected,
  scrollRef,
  onScroll,
  onOpenDialog,
}: {
  detail: TaskDetailProps;
  selected: TaskPlanningSnapshot;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: (element: HTMLDivElement) => void;
  onOpenDialog: (kind: TaskDetailDialogKind) => void;
}) {
  const failureSummary = getTaskFailureSummary(selected);
  return (
    <section className="min-h-0 min-w-0 flex flex-col">
      <div
        ref={scrollRef}
        onScroll={(event) => onScroll(event.currentTarget)}
        className="flex-1 min-h-0 overflow-auto"
      >
        <TaskDetailHeader onOpenDialog={onOpenDialog} />
        <div className="min-w-0 flex flex-col gap-5 p-4 md:p-6">
          {failureSummary && <TaskFailureBanner summary={failureSummary} />}
          <TaskRecordsPanel artifacts={detail.sortedArtifacts} />
        </div>
      </div>
      <div className="shrink-0 border-t border-border-color bg-bg-secondary p-3 md:p-4">
        <ExistingTaskComposer
          snapshot={selected}
          flow={selected.flow}
          messageBody={detail.messageBody}
          attachments={detail.messageAttachments}
          executionMode={detail.messageExecutionMode}
          runtimeExecutionMode={detail.messageRuntimeExecutionMode}
          busyAction={detail.busyAction}
          onMessageChange={detail.onMessageChange}
          onAttachmentsChange={detail.onMessageAttachmentsChange}
          onExecutionModeChange={detail.onMessageExecutionModeChange}
          onRuntimeExecutionModeChange={
            detail.onMessageRuntimeExecutionModeChange
          }
          onSubmitMessage={detail.onSubmitMessage}
          onCancelAgentRun={detail.onCancelAgentRun}
        />
      </div>
    </section>
  );
}

function TaskFailureBanner({ summary }: { summary: string }) {
  return (
    <section className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
      <div className="font-semibold">Agent 运行失败</div>
      <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-rose-100/90">
        {summary}
      </div>
    </section>
  );
}

function SelectedTaskFlowAside({
  detail,
  selected,
}: {
  detail: TaskDetailProps;
  selected: TaskPlanningSnapshot;
}) {
  return (
    <aside className="min-h-0 min-w-0 overflow-hidden border-t border-border-color 2xl:border-l 2xl:border-t-0">
      <div className="h-full min-w-0 overflow-auto p-4 md:p-5">
        <TaskFlowPanel
          flow={selected.flow}
          currentPlan={selected.currentPlan}
          busyAction={detail.busyAction}
          onAction={detail.onAction}
        />
      </div>
    </aside>
  );
}
