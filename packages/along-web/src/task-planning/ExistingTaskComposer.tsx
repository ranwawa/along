import type {
  TaskAgentRunRecord,
  TaskExecutionMode,
  TaskFlowAction,
  TaskPlanningSnapshot,
  TaskRuntimeExecutionMode,
} from '../types';
import { TaskComposerInput } from './TaskComposerInput';

const LABELS = {
  placeholder: '补充反馈、继续提问或说明交付后的修改要求',
  send: '发送',
} as const;

function getMessageActions(flow: TaskPlanningSnapshot['flow']) {
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

function getLatestRunningRun(
  snapshot: TaskPlanningSnapshot,
): TaskAgentRunRecord | null {
  const runFromRuns =
    [...(snapshot.agentRuns || [])]
      .filter((run) => run.status === 'running')
      .sort((left, right) =>
        right.startedAt.localeCompare(left.startedAt),
      )[0] || null;
  if (runFromRuns) return runFromRuns;
  return (
    (snapshot.agentStages || [])
      .map((stage) => stage.latestRun)
      .filter((run): run is TaskAgentRunRecord => run?.status === 'running')
      .sort((left, right) =>
        right.startedAt.localeCompare(left.startedAt),
      )[0] || null
  );
}

function isSubmitDisabled(input: {
  busyAction: string | null;
  canSubmitMessage: boolean;
  hasDraft: boolean;
  runningRun: TaskAgentRunRecord | null;
}) {
  return input.runningRun
    ? input.busyAction === 'cancel-agent'
    : !input.canSubmitMessage || !input.hasDraft || Boolean(input.busyAction);
}

type ExistingTaskComposerProps = {
  snapshot: TaskPlanningSnapshot;
  flow: TaskPlanningSnapshot['flow'];
  messageBody: string;
  attachments: File[];
  executionMode: TaskExecutionMode;
  runtimeExecutionMode: TaskRuntimeExecutionMode;
  busyAction: string | null;
  onMessageChange: (value: string) => void;
  onAttachmentsChange: (files: File[]) => void;
  onExecutionModeChange: (value: TaskExecutionMode) => void;
  onRuntimeExecutionModeChange: (value: TaskRuntimeExecutionMode) => void;
  onSubmitMessage: () => void;
  onCancelAgentRun: (runId?: string) => void;
};

function buildComposerProps(props: ExistingTaskComposerProps) {
  const { snapshot, flow, messageBody, attachments, busyAction } = props;
  const messageActions = getMessageActions(flow);
  const canSubmitMessage = messageActions.some((action) => action.enabled);
  const hasDraft = Boolean(messageBody.trim()) || attachments.length > 0;
  const submitAction =
    messageActions.find((action) => action.enabled) || messageActions[0];
  const runningRun = getLatestRunningRun(snapshot);
  return {
    canSubmitMessage,
    hasDraft,
    submitAction,
    runningRun,
    submitDisabled: isSubmitDisabled({
      busyAction,
      canSubmitMessage,
      hasDraft,
      runningRun,
    }),
  };
}

export function ExistingTaskComposer(props: ExistingTaskComposerProps) {
  const { canSubmitMessage, runningRun, submitAction, submitDisabled } =
    buildComposerProps(props);
  return (
    <TaskComposerInput
      attachments={props.attachments}
      body={props.messageBody}
      busy={props.busyAction === 'message'}
      disabled={!canSubmitMessage && !runningRun}
      executionMode={props.executionMode}
      runtimeExecutionMode={props.runtimeExecutionMode}
      placeholder={LABELS.placeholder}
      runningRun={runningRun}
      submitDisabled={submitDisabled}
      submitTitle={
        submitAction?.description || submitAction?.label || LABELS.send
      }
      onAttachmentsChange={props.onAttachmentsChange}
      onBodyChange={props.onMessageChange}
      onExecutionModeChange={props.onExecutionModeChange}
      onRuntimeExecutionModeChange={props.onRuntimeExecutionModeChange}
      onCancelAgentRun={props.onCancelAgentRun}
      onSubmit={(event) => {
        event.preventDefault();
        if (runningRun) return;
        props.onSubmitMessage();
      }}
    />
  );
}
