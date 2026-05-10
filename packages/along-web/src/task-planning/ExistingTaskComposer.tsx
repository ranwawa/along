import type {
  TaskAgentRunRecord,
  TaskExecutionMode,
  TaskFlowAction,
  TaskPlanningSnapshot,
  TaskRuntimeExecutionMode,
} from '../types';
import { TaskComposerInput } from './TaskComposerInput';

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

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: composer wiring stays explicit for prop flow readability.
export function ExistingTaskComposer({
  snapshot,
  flow,
  messageBody,
  attachments,
  executionMode,
  runtimeExecutionMode,
  busyAction,
  onMessageChange,
  onAttachmentsChange,
  onExecutionModeChange,
  onRuntimeExecutionModeChange,
  onSubmitMessage,
  onCancelAgentRun,
}: {
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
}) {
  const messageActions = getMessageActions(flow);
  const canSubmitMessage = messageActions.some((action) => action.enabled);
  const hasDraft = Boolean(messageBody.trim()) || attachments.length > 0;
  const submitAction =
    messageActions.find((action) => action.enabled) || messageActions[0];
  const runningRun = getLatestRunningRun(snapshot);
  return (
    <TaskComposerInput
      attachments={attachments}
      body={messageBody}
      busy={busyAction === 'message'}
      disabled={!canSubmitMessage && !runningRun}
      executionMode={executionMode}
      runtimeExecutionMode={runtimeExecutionMode}
      placeholder="补充反馈、继续提问或说明交付后的修改要求"
      runningRun={runningRun}
      submitDisabled={isSubmitDisabled({
        busyAction,
        canSubmitMessage,
        hasDraft,
        runningRun,
      })}
      submitTitle={submitAction?.description || submitAction?.label || '发送'}
      onAttachmentsChange={onAttachmentsChange}
      onBodyChange={onMessageChange}
      onExecutionModeChange={onExecutionModeChange}
      onRuntimeExecutionModeChange={onRuntimeExecutionModeChange}
      onCancelAgentRun={onCancelAgentRun}
      onSubmit={(event) => {
        event.preventDefault();
        if (runningRun) return;
        onSubmitMessage();
      }}
    />
  );
}
