import type { FormEvent } from 'react';
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
  type CreateTaskResponse,
  type DraftTaskInput,
  emptyDraft,
  type ManualCompleteResponse,
  mergeSnapshotIntoList,
  readJsonResponse,
  type SubmitTaskMessageResponse,
} from './api';
import { type FlowActionParts, runFlowAction } from './flowActionRouter';

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function applySnapshot(
  snapshot: TaskPlanningSnapshot,
  input: Pick<UseTaskPlanningActionsInput, 'setSelectedSnapshot' | 'setTasks'>,
) {
  input.setSelectedSnapshot(snapshot);
  input.setTasks((previous) => mergeSnapshotIntoList(previous, snapshot));
}

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

function buildCreatePayload(input: UseTaskPlanningActionsInput, body: string) {
  const payload: Record<string, string | boolean> = { body, autoRun: true };
  if (input.draft.title.trim()) payload.title = input.draft.title.trim();
  if (input.selectedRepository) {
    payload.owner = input.selectedRepository.owner;
    payload.repo = input.selectedRepository.repo;
  }
  return payload;
}

async function postCreateTask(payload: Record<string, string | boolean>) {
  const response = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readJsonResponse<CreateTaskResponse>(response);
}

function useDraftActions(input: UseTaskPlanningActionsInput) {
  const updateDraft = (key: keyof DraftTaskInput, value: string) => {
    input.setDraft((previous) => {
      if (key !== 'repository') return { ...previous, [key]: value };
      return { ...emptyDraft, repository: value };
    });
    if (key === 'repository') {
      input.setSelectedTaskId(null);
      input.setSelectedSnapshot(null);
      input.setMessageBody('');
      input.setIsNewTaskOpen(false);
    }
  };
  const openNewTask = () => {
    input.setDraft((previous) => ({
      ...emptyDraft,
      repository: previous.repository,
    }));
    input.setSelectedTaskId(null);
    input.setSelectedSnapshot(null);
    input.setMessageBody('');
    input.setIsNewTaskOpen(true);
  };
  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    const body = input.draft.body.trim();
    if (!body || input.busyAction) return;
    await runBusy(input, 'create', async () => {
      const result = await postCreateTask(buildCreatePayload(input, body));
      input.setDraft((previous) => ({
        ...emptyDraft,
        repository: previous.repository,
      }));
      input.setIsNewTaskOpen(false);
      input.setSelectedTaskId(result.taskId);
      applySnapshot(result.snapshot, input);
    });
  };
  return { createTask, openNewTask, updateDraft };
}

function useRepositoryActions(input: UseTaskPlanningActionsInput) {
  const refreshRepositories = async () => {
    if (input.repositoriesRefreshing) return;
    input.setRepositoriesRefreshing(true);
    input.setError(null);
    try {
      await readJsonResponse<unknown>(
        await fetch('/api/rescan', { method: 'POST' }),
      );
      input.setDraft((previous) => ({ ...previous, repository: '' }));
      await input.loadRepositories();
    } catch (err: unknown) {
      input.setError(getErrorMessage(err));
    } finally {
      input.setRepositoriesRefreshing(false);
    }
  };
  return { refreshRepositories };
}

function useSelectionActions(input: UseTaskPlanningActionsInput) {
  const selectTask = (snapshot: TaskPlanningSnapshot) => {
    input.setIsNewTaskOpen(false);
    input.setSelectedTaskId(snapshot.task.taskId);
    input.setSelectedSnapshot(snapshot);
    input.setMessageBody('');
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
    if (!input.selected || input.busyAction) return;
    await runBusy(input, 'message', async () => {
      const result = await api.postSelected<SubmitTaskMessageResponse>(
        'messages',
        { body, autoRun: true },
      );
      input.setMessageBody('');
      await api.updateFromOptionalSnapshot(result.snapshot);
    });
  };
  const submitMessageFromFlow = async () => {
    const body = input.messageBody.trim();
    if (body) await sendTaskMessage(body);
  };
  return { sendTaskMessage, submitMessageFromFlow };
}

function useSimpleFlowActions(
  input: UseTaskPlanningActionsInput,
  api: ReturnType<typeof useSelectedTaskApi>,
) {
  const runSimpleAction = async (
    actionKey: string,
    path: string,
    canRun: boolean,
  ) => {
    if (!input.selected || !canRun || input.busyAction) return;
    const taskId = input.selected.task.taskId;
    await runBusy(input, actionKey, async () => {
      const result = await api.postSelected<SimpleActionResponse>(path, {});
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
  const simple = useSimpleFlowActions(input, api);
  const manual = useManualActions(input, api);
  return { ...messages, ...simple, ...manual };
}

function useFlowActions(input: UseTaskPlanningActionsInput) {
  const parts = useFlowActionParts(input);
  const handleFlowAction = (action: TaskFlowAction) => {
    if (!input.selected || !action.enabled || input.busyAction) return;
    runFlowAction(action, input, parts);
  };
  return {
    submitMessageFromFlow: parts.submitMessageFromFlow,
    handleFlowAction,
  };
}

export function useTaskPlanningActions(input: UseTaskPlanningActionsInput) {
  return {
    ...useDraftActions(input),
    ...useRepositoryActions(input),
    ...useSelectionActions(input),
    ...useFlowActions(input),
  };
}
