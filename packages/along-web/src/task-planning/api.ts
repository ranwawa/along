import type { TaskPlanningSnapshot } from '../types';

export interface CreateTaskResponse {
  taskId: string;
  scheduled: boolean;
  snapshot: TaskPlanningSnapshot;
}

export interface SubmitTaskMessageResponse {
  taskId: string;
  scheduled: boolean;
  snapshot: TaskPlanningSnapshot | null;
}

export interface ApproveTaskPlanResponse {
  taskId: string;
  snapshot: TaskPlanningSnapshot | null;
}

export interface PlannerRunResponse {
  taskId: string;
  scheduled: boolean;
}

export interface ImplementationRunResponse {
  taskId: string;
  scheduled: boolean;
}

export interface DeliveryRunResponse {
  taskId: string;
  scheduled: boolean;
}

export interface ManualCompleteResponse {
  taskId: string;
  snapshot: TaskPlanningSnapshot;
}

export interface CompleteTaskResponse {
  taskId: string;
  snapshot: TaskPlanningSnapshot;
}

export interface RepositoryOption {
  owner: string;
  repo: string;
  fullName: string;
  path: string;
  isDefault: boolean;
}

export interface RepositoryListResponse {
  repositories: RepositoryOption[];
  defaultRepository?: string;
}

export interface DraftTaskInput {
  title: string;
  body: string;
  repository: string;
}

interface TaskApiError {
  error?: string;
}

export const emptyDraft: DraftTaskInput = {
  title: '',
  body: '',
  repository: '',
};

export function mergeSnapshotIntoList(
  previous: TaskPlanningSnapshot[],
  snapshot: TaskPlanningSnapshot,
): TaskPlanningSnapshot[] {
  const next = previous.filter(
    (item) => item.task.taskId !== snapshot.task.taskId,
  );
  return [snapshot, ...next].sort((left, right) =>
    right.task.updatedAt.localeCompare(left.task.updatedAt),
  );
}

function isTaskApiError(value: unknown): value is TaskApiError {
  return value !== null && typeof value === 'object' && 'error' in value;
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      isTaskApiError(payload) && typeof payload.error === 'string'
        ? payload.error
        : `请求失败: ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}
