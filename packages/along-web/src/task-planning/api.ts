import type { TaskExecutionMode, TaskPlanningSnapshot } from '../types';

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
  body: string;
  repository: string;
  executionMode: TaskExecutionMode;
}

interface TaskApiError {
  error?: string;
}

export const emptyDraft: DraftTaskInput = {
  body: '',
  repository: '',
  executionMode: 'manual',
};

function parseTaskSeq(snapshot: TaskPlanningSnapshot): number | null {
  const seq: unknown = snapshot.task.seq;
  if (typeof seq === 'number') {
    return Number.isFinite(seq) ? seq : null;
  }
  if (typeof seq === 'string') {
    const trimmed = seq.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function sortTaskSnapshotsBySeqDesc(
  snapshots: TaskPlanningSnapshot[],
): TaskPlanningSnapshot[] {
  return snapshots
    .map((snapshot, index) => ({
      index,
      seq: parseTaskSeq(snapshot),
      snapshot,
    }))
    .sort((left, right) => {
      if (left.seq != null && right.seq != null) {
        const seqDiff = right.seq - left.seq;
        return seqDiff === 0 ? left.index - right.index : seqDiff;
      }
      if (left.seq != null) return -1;
      if (right.seq != null) return 1;
      return left.index - right.index;
    })
    .map((entry) => entry.snapshot);
}

export function mergeSnapshotIntoList(
  previous: TaskPlanningSnapshot[],
  snapshot: TaskPlanningSnapshot,
): TaskPlanningSnapshot[] {
  const existingIndex = previous.findIndex(
    (item) => item.task.taskId === snapshot.task.taskId,
  );
  if (existingIndex >= 0) {
    const next = [...previous];
    next[existingIndex] = snapshot;
    return sortTaskSnapshotsBySeqDesc(next);
  }
  return sortTaskSnapshotsBySeqDesc([...previous, snapshot]);
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
