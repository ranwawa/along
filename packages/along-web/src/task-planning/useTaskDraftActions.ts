import type { FormEvent } from 'react';
import type { UseTaskPlanningActionsInput } from './actionTypes';
import {
  type CreateTaskResponse,
  type DraftTaskInput,
  emptyDraft,
  readJsonResponse,
} from './api';
import {
  applySnapshot,
  buildMultipartPayload,
} from './taskPlanningActionUtils';

function buildCreatePayload(input: UseTaskPlanningActionsInput, body: string) {
  const payload: Record<string, string | boolean> = {
    body,
    autoRun: true,
    runtimeExecutionMode: input.draft.runtimeExecutionMode,
  };
  if (input.draft.executionMode === 'autonomous') {
    payload.executionMode = 'autonomous';
  }
  if (input.selectedRepository) {
    payload.owner = input.selectedRepository.owner;
    payload.repo = input.selectedRepository.repo;
  }
  return payload;
}

async function postCreateTask(
  payload: Record<string, string | boolean>,
  attachments: File[],
) {
  if (attachments.length > 0) {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      body: buildMultipartPayload(payload, attachments),
    });
    return readJsonResponse<CreateTaskResponse>(response);
  }
  const response = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readJsonResponse<CreateTaskResponse>(response);
}

function clearSelectedTask(input: UseTaskPlanningActionsInput) {
  input.setSelectedTaskId(null);
  input.setSelectedSnapshot(null);
  input.setMessageBody('');
  input.setMessageAttachments([]);
  input.setMessageExecutionMode('manual');
  input.setMessageRuntimeExecutionMode('auto');
}

function resetDraft(input: UseTaskPlanningActionsInput) {
  input.setDraft((previous) => ({
    ...emptyDraft,
    repository: previous.repository,
  }));
}

async function runCreateTask(input: UseTaskPlanningActionsInput, body: string) {
  const result = await postCreateTask(
    buildCreatePayload(input, body),
    input.draft.attachments,
  );
  resetDraft(input);
  input.setIsNewTaskOpen(false);
  input.setSelectedTaskId(result.taskId);
  applySnapshot(result.snapshot, input);
}

export function useDraftActions(
  input: UseTaskPlanningActionsInput,
  runBusy: (
    input: UseTaskPlanningActionsInput,
    actionKey: string,
    action: () => Promise<void>,
  ) => Promise<void>,
) {
  const updateDraft = (key: keyof DraftTaskInput, value: string) => {
    input.setDraft((previous) => {
      if (key === 'attachments') return previous;
      if (key !== 'repository') return { ...previous, [key]: value };
      return { ...emptyDraft, repository: value };
    });
    if (key !== 'repository') return;
    clearSelectedTask(input);
    input.setIsNewTaskOpen(false);
  };
  const openNewTask = () => {
    resetDraft(input);
    clearSelectedTask(input);
    input.setIsNewTaskOpen(true);
  };
  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    const body = input.draft.body.trim();
    if ((!body && input.draft.attachments.length === 0) || input.busyAction) {
      return;
    }
    await runBusy(input, 'create', () => runCreateTask(input, body));
  };
  return { createTask, openNewTask, updateDraft };
}
