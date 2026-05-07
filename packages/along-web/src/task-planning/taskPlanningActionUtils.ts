import type { TaskPlanningSnapshot } from '../types';
import type { UseTaskPlanningActionsInput } from './actionTypes';
import { mergeSnapshotIntoList } from './api';

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function applySnapshot(
  snapshot: TaskPlanningSnapshot,
  input: Pick<UseTaskPlanningActionsInput, 'setSelectedSnapshot' | 'setTasks'>,
) {
  input.setSelectedSnapshot(snapshot);
  input.setTasks((previous) => mergeSnapshotIntoList(previous, snapshot));
}

export function buildMultipartPayload(
  payload: Record<string, string | boolean>,
  attachments: File[],
): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    form.append(key, String(value));
  }
  for (const attachment of attachments) {
    form.append('attachments', attachment);
  }
  return form;
}
