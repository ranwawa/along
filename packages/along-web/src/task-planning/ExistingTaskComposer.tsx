import type {
  TaskAgentRunRecord,
  TaskExecutionMode,
  TaskFlowAction,
  TaskPlanningSnapshot,
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

export function ExistingTaskComposer({
  snapshot,
  flow,
  messageBody,
  attachments,
  executionMode,
  busyAction,
  onMessageChange,
  onAttachmentsChange,
  onExecutionModeChange,
  onSubmitMessage,
  onCancelAgentRun,
}: {
  snapshot: TaskPlanningSnapshot;
  flow: TaskPlanningSnapshot['flow'];
  messageBody: string;
  attachments: File[];
  executionMode: TaskExecutionMode;
  busyAction: string | null;
  onMessageChange: (value: string) => void;
  onAttachmentsChange: (files: File[]) => void;
  onExecutionModeChange: (value: TaskExecutionMode) => void;
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
      placeholder="补充反馈、继续提问或说明交付后的修改要求"
      runningRun={runningRun}
      submitDisabled={
        runningRun
          ? busyAction === 'cancel-agent'
          : !canSubmitMessage || !hasDraft || Boolean(busyAction)
      }
      submitTitle={submitAction?.description || submitAction?.label || '发送'}
      onAttachmentsChange={onAttachmentsChange}
      onBodyChange={onMessageChange}
      onExecutionModeChange={onExecutionModeChange}
      onCancelAgentRun={onCancelAgentRun}
      onSubmit={(event) => {
        event.preventDefault();
        if (runningRun) return;
        onSubmitMessage();
      }}
    />
  );
}
