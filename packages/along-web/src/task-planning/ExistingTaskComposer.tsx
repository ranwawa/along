import type { TaskFlowAction, TaskPlanningSnapshot } from '../types';
import { getFlowActionClass } from './format';
import { ImageAttachmentPicker } from './TaskImageAttachments';

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

function MessageActionButtons({
  actions,
  busyAction,
  hasDraft,
}: {
  actions: TaskFlowAction[];
  busyAction: string | null;
  hasDraft: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <button
          key={action.id}
          type="submit"
          disabled={!action.enabled || !hasDraft || Boolean(busyAction)}
          title={!action.enabled ? action.disabledReason : action.description}
          className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${getFlowActionClass(
            action,
          )}`}
        >
          {busyAction === 'message' ? '发送中' : action.label}
        </button>
      ))}
    </div>
  );
}

export function ExistingTaskComposer({
  flow,
  messageBody,
  attachments,
  busyAction,
  onMessageChange,
  onAttachmentsChange,
  onSubmitMessage,
}: {
  flow: TaskPlanningSnapshot['flow'];
  messageBody: string;
  attachments: File[];
  busyAction: string | null;
  onMessageChange: (value: string) => void;
  onAttachmentsChange: (files: File[]) => void;
  onSubmitMessage: () => void;
}) {
  const messageActions = getMessageActions(flow);
  const canSubmitMessage = messageActions.some((action) => action.enabled);
  const hasDraft = Boolean(messageBody.trim()) || attachments.length > 0;
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
      <ImageAttachmentPicker
        attachments={attachments}
        disabled={!canSubmitMessage}
        onChange={onAttachmentsChange}
      />
      <MessageActionButtons
        actions={messageActions}
        busyAction={busyAction}
        hasDraft={hasDraft}
      />
    </form>
  );
}
