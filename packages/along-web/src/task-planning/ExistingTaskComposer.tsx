import type {
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

export function ExistingTaskComposer({
  flow,
  messageBody,
  attachments,
  executionMode,
  busyAction,
  onMessageChange,
  onAttachmentsChange,
  onExecutionModeChange,
  onSubmitMessage,
}: {
  flow: TaskPlanningSnapshot['flow'];
  messageBody: string;
  attachments: File[];
  executionMode: TaskExecutionMode;
  busyAction: string | null;
  onMessageChange: (value: string) => void;
  onAttachmentsChange: (files: File[]) => void;
  onExecutionModeChange: (value: TaskExecutionMode) => void;
  onSubmitMessage: () => void;
}) {
  const messageActions = getMessageActions(flow);
  const canSubmitMessage = messageActions.some((action) => action.enabled);
  const hasDraft = Boolean(messageBody.trim()) || attachments.length > 0;
  const submitAction =
    messageActions.find((action) => action.enabled) || messageActions[0];
  return (
    <TaskComposerInput
      attachments={attachments}
      body={messageBody}
      busy={busyAction === 'message'}
      disabled={!canSubmitMessage}
      executionMode={executionMode}
      placeholder="补充反馈、继续提问或说明交付后的修改要求"
      submitDisabled={!canSubmitMessage || !hasDraft || Boolean(busyAction)}
      submitTitle={submitAction?.description || submitAction?.label || '发送'}
      onAttachmentsChange={onAttachmentsChange}
      onBodyChange={onMessageChange}
      onExecutionModeChange={onExecutionModeChange}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmitMessage();
      }}
    />
  );
}
