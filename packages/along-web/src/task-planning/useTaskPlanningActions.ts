import type {
  TaskAgentStageRecord,
  TaskFlowAction,
  TaskPlanningSnapshot,
} from '../types';
import type {
  SimpleActionResponse,
  UseTaskPlanningActionsInput,
} from './actionTypes';
import {
  type CancelAgentRunResponse,
  type ManualCompleteResponse,
  readJsonResponse,
  type SubmitTaskMessageResponse,
} from './api';
import { type FlowActionParts, runFlowAction } from './flowActionRouter';
import {
  applySnapshot,
  buildMultipartPayload,
  getErrorMessage,
} from './taskPlanningActionUtils';
import { useDraftActions } from './useTaskDraftActions';

async function runBusy(
  input: UseTaskPlanningActionsInput,
  actionKey: string,
  action: () => Promise<void>,
) {
  input.setBusyAction(actionKey);
  input.setError(null);
  try {
    await action();
  } catch (err: unknown) {
    input.setError(getErrorMessage(err));
  } finally {
    input.setBusyAction(null);
  }
}

function useSelectionActions(input: UseTaskPlanningActionsInput) {
  const selectTask = (snapshot: TaskPlanningSnapshot) => {
    input.setIsNewTaskOpen(false);
    input.setSelectedTaskId(snapshot.task.taskId);
    input.setSelectedSnapshot(snapshot);
    input.setMessageBody('');
    input.setMessageAttachments([]);
    input.setMessageExecutionMode(snapshot.task.executionMode);
    input.setMessageRuntimeExecutionMode('auto');
  };
  return { selectTask };
}

function useSelectedTaskApi(input: UseTaskPlanningActionsInput) {
  const updateFromOptionalSnapshot = async (
    snapshot: TaskPlanningSnapshot | null,
  ) => {
    if (snapshot) applySnapshot(snapshot, input);
    else if (input.selected) {
      await input.loadSelectedTask(input.selected.task.taskId);
    }
  };
  const postSelected = async <T>(path: string, body: unknown): Promise<T> => {
    if (!input.selected) throw new Error('未选择 Task');
    const response = await fetch(selectedTaskApiPath(input, path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return readJsonResponse<T>(response);
  };
  return { postSelected, updateFromOptionalSnapshot };
}

function selectedTaskApiPath(input: UseTaskPlanningActionsInput, path: string) {
  return `/api/tasks/${input.selected?.task.taskId}/${path}`;
}

function useMessageActions(
  input: UseTaskPlanningActionsInput,
  api: ReturnType<typeof useSelectedTaskApi>,
) {
  const sendTaskMessage = async (body: string) => {
    if (shouldSkipMessageSend(input)) return;
    await runBusy(input, 'message', async () => {
      const result = await postTaskMessage(input, api, body);
      input.setMessageBody('');
      input.setMessageAttachments([]);
      await api.updateFromOptionalSnapshot(result.snapshot);
    });
  };
  const submitMessageFromFlow = async () => {
    const body = input.messageBody.trim();
    if (body || input.messageAttachments.length > 0) {
      await sendTaskMessage(body);
    }
  };
  return { sendTaskMessage, submitMessageFromFlow };
}

function shouldSkipMessageSend(input: UseTaskPlanningActionsInput): boolean {
  return (
    !input.selected ||
    Boolean(input.busyAction) ||
    hasRunningAgentRun(input.selected)
  );
}

function postTaskMessage(
  input: UseTaskPlanningActionsInput,
  api: ReturnType<typeof useSelectedTaskApi>,
  body: string,
): Promise<SubmitTaskMessageResponse> {
  const payload = {
    body,
    autoRun: true,
    executionMode: input.messageExecutionMode,
    runtimeExecutionMode: input.messageRuntimeExecutionMode,
  };
  return input.messageAttachments.length > 0
    ? postSelectedMultipart<SubmitTaskMessageResponse>(
        input,
        'messages',
        payload,
        input.messageAttachments,
      )
    : api.postSelected<SubmitTaskMessageResponse>('messages', payload);
}

function hasRunningAgentRun(snapshot: TaskPlanningSnapshot): boolean {
  return snapshot.agentRuns.some((run) => run.status === 'running');
}

function useAgentCancellationActions(
  input: UseTaskPlanningActionsInput,
  api: ReturnType<typeof useSelectedTaskApi>,
) {
  const cancelAgentRun = async (runId?: string) => {
    if (!input.selected || input.busyAction) return;
    await runBusy(input, 'cancel-agent', async () => {
      const result = await api.postSelected<CancelAgentRunResponse>(
        'cancel-agent',
        {
          runId,
          reason: '用户从聊天框中断当前 Agent 会话',
        },
      );
      applySnapshot(result.snapshot, input);
    });
  };
  return { cancelAgentRun };
}

async function postSelectedMultipart<T>(
  input: UseTaskPlanningActionsInput,
  path: string,
  payload: Record<string, string | boolean>,
  attachments: File[],
): Promise<T> {
  if (!input.selected) throw new Error('未选择 Task');
  const response = await fetch(selectedTaskApiPath(input, path), {
    method: 'POST',
    body: buildMultipartPayload(payload, attachments),
  });
  return readJsonResponse<T>(response);
}

function useSimpleFlowActions(
  input: UseTaskPlanningActionsInput,
  api: ReturnType<typeof useSelectedTaskApi>,
) {
  const runSimpleAction = async (
    actionKey: string,
    path: string,
    canRun: boolean,
    body: Record<string, unknown> = {},
  ) => {
    if (!input.selected || !canRun || input.busyAction) return;
    const taskId = input.selected.task.taskId;
    await runBusy(input, actionKey, async () => {
      const result = await api.postSelected<SimpleActionResponse>(path, body);
      if ('snapshot' in result)
        await api.updateFromOptionalSnapshot(result.snapshot);
      else await input.loadSelectedTask(taskId);
    });
  };
  return { runSimpleAction };
}

function getDeliveryPrUrl(stage: TaskAgentStageRecord) {
  if (stage.stage !== 'delivery') return undefined;
  return window.prompt('PR URL（如已人工创建 PR，请填写）', '')?.trim();
}

function useManualActions(
  input: UseTaskPlanningActionsInput,
  api: ReturnType<typeof useSelectedTaskApi>,
) {
  return {
    ...useCopyManualResumeCommand(input),
    ...useCompleteManualStage(input, api),
  };
}

function useCopyManualResumeCommand(input: UseTaskPlanningActionsInput) {
  const copyManualResumeCommand = async (stage: TaskAgentStageRecord) => {
    const command = stage.manualResume?.command;
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
    } catch (err: unknown) {
      input.setError(getErrorMessage(err));
    }
  };
  return { copyManualResumeCommand };
}

function useCompleteManualStage(
  input: UseTaskPlanningActionsInput,
  api: ReturnType<typeof useSelectedTaskApi>,
) {
  const completeManualStage = async (stage: TaskAgentStageRecord) => {
    if (!input.selected || input.busyAction) return;
    const rawMessage = window.prompt(
      stagePrompt(stage),
      '已人工接管并处理完成。',
    );
    if (rawMessage === null) return;
    await runBusy(input, `manual-${stage.stage}`, async () => {
      const result = await api.postSelected<ManualCompleteResponse>(
        'manual-complete',
        {
          stage: stage.stage,
          message: rawMessage.trim() || undefined,
          prUrl: getDeliveryPrUrl(stage),
        },
      );
      applySnapshot(result.snapshot, input);
    });
  };
  return { completeManualStage };
}

function stagePrompt(stage: TaskAgentStageRecord) {
  return `${stage.label}人工处理说明`;
}

function useFlowActionParts(
  input: UseTaskPlanningActionsInput,
): FlowActionParts {
  const api = useSelectedTaskApi(input);
  const messages = useMessageActions(input, api);
  const cancellations = useAgentCancellationActions(input, api);
  const simple = useSimpleFlowActions(input, api);
  const manual = useManualActions(input, api);
  return { ...messages, ...cancellations, ...simple, ...manual };
}

function useFlowActions(input: UseTaskPlanningActionsInput) {
  const parts = useFlowActionParts(input);
  const handleFlowAction = (action: TaskFlowAction) => {
    if (!input.selected || !action.enabled || input.busyAction) return;
    runFlowAction(action, input, parts);
  };
  return {
    submitMessageFromFlow: parts.submitMessageFromFlow,
    cancelAgentRun: parts.cancelAgentRun,
    handleFlowAction,
  };
}

export function useTaskPlanningActions(input: UseTaskPlanningActionsInput) {
  return {
    ...useDraftActions(input, runBusy),
    ...useSelectionActions(input),
    ...useFlowActions(input),
  };
}
