import { iso_timestamp } from '../../core/common';
import { getDb } from '../../core/db';
import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import type {
  DomainEvent,
  WorkflowRuntimeState,
} from '../../domain/workflow/state';
import { reduceWorkflowEvent } from '../../domain/workflow/state';
import { normalizeLifecycle, type TaskItemRow, type TaskThreadRow } from './db';
import type {
  UpdateTaskDeliveryInput,
  UpdateTaskRepositoryInput,
} from './inputs';
import { readTaskPlanningSnapshot } from './read';
import type { ThreadStatus } from './types';
import {
  LIFECYCLE,
  THREAD_PURPOSE,
  THREAD_STATUS,
  WORKFLOW_KIND,
} from './types';

export function updateTaskStatus(): Result<void> {
  return failure('旧 task.status 已禁止直接写入，请更新分层状态字段');
}

function deriveThreadStatusFromWorkflow(
  state: WorkflowRuntimeState,
): ThreadStatus | null {
  if (state.lifecycle === LIFECYCLE.FAILED) return THREAD_STATUS.FAILED;
  if (state.lifecycle === LIFECYCLE.DONE) return THREAD_STATUS.COMPLETED;
  switch (state.workflowState) {
    case 'drafting':
      return THREAD_STATUS.DRAFTING;
    case 'awaiting_approval':
      return THREAD_STATUS.AWAITING_APPROVAL;
    case 'revising':
      return THREAD_STATUS.DRAFTING;
    case 'implementing':
      return THREAD_STATUS.IMPLEMENTING;
    case 'verifying':
      return THREAD_STATUS.VERIFYING;
    case 'implemented':
      return THREAD_STATUS.COMPLETED;
    default:
      return null;
  }
}

function runTransitionTxn(
  db: ReturnType<typeof getDb> extends { success: true; data: infer D }
    ? D
    : never,
  taskId: string,
  next: WorkflowRuntimeState,
  threadStatus: ThreadStatus | null,
  now: string,
) {
  db.prepare(
    'UPDATE task_items SET lifecycle = ?, current_workflow_kind = ?, updated_at = ? WHERE task_id = ?',
  ).run(next.lifecycle, next.currentWorkflowKind, now, taskId);
  if (threadStatus) {
    db.prepare(
      'UPDATE task_threads SET status = ?, updated_at = ? WHERE task_id = ? AND thread_id = (SELECT active_thread_id FROM task_items WHERE task_id = ?)',
    ).run(threadStatus, now, taskId, taskId);
  }
}

export function transitionTaskWorkflow(input: {
  taskId: string;
  event: DomainEvent;
}): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const taskRow = dbRes.data
      .prepare('SELECT * FROM task_items WHERE task_id = ?')
      .get(input.taskId) as TaskItemRow | null;
    if (!taskRow) return failure(`Task 不存在: ${input.taskId}`);

    const threadRow = dbRes.data
      .prepare('SELECT * FROM task_threads WHERE task_id = ? AND thread_id = ?')
      .get(input.taskId, taskRow.active_thread_id) as TaskThreadRow | null;

    const currentState: WorkflowRuntimeState = {
      lifecycle: normalizeLifecycle(taskRow.lifecycle),
      currentWorkflowKind:
        (taskRow.current_workflow_kind as WorkflowRuntimeState['currentWorkflowKind']) ||
        WORKFLOW_KIND.PLAN,
      workflowState:
        (threadRow?.status as WorkflowRuntimeState['workflowState']) ||
        'drafting',
    };

    const next = reduceWorkflowEvent(currentState, input.event);
    const threadStatus = deriveThreadStatusFromWorkflow(next);
    const now = iso_timestamp();
    dbRes.data.transaction(() =>
      runTransitionTxn(dbRes.data, input.taskId, next, threadStatus, now),
    )();
    return success(undefined);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`Task 工作流状态转换失败: ${message}`);
  }
}

export function updateTaskDelivery(
  input: UpdateTaskDeliveryInput,
): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const taskRow = dbRes.data
      .prepare('SELECT lifecycle FROM task_items WHERE task_id = ?')
      .get(input.taskId) as { lifecycle: string | null } | null;
    if (!taskRow) return failure(`Task 不存在: ${input.taskId}`);
    if (normalizeLifecycle(taskRow.lifecycle) === LIFECYCLE.DONE)
      return failure('Task 已关闭，不能更新交付信息');

    const result = dbRes.data
      .prepare(
        `UPDATE task_items
       SET branch_name = COALESCE(?, branch_name), worktree_path = COALESCE(?, worktree_path),
           commit_shas = COALESCE(?, commit_shas), pr_url = COALESCE(?, pr_url),
           pr_number = COALESCE(?, pr_number), updated_at = ?
       WHERE task_id = ?`,
      )
      .run(
        input.branchName || null,
        input.worktreePath || null,
        input.commitShas ? JSON.stringify(input.commitShas) : null,
        input.prUrl || null,
        input.prNumber || null,
        iso_timestamp(),
        input.taskId,
      );
    return result.changes > 0
      ? success(undefined)
      : failure(`Task 不存在: ${input.taskId}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`更新 Task Delivery 信息失败: ${message}`);
  }
}

export function updateTaskRepository(
  input: UpdateTaskRepositoryInput,
): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const result = dbRes.data
      .prepare(
        `UPDATE task_items SET repo_owner = ?, repo_name = ?, cwd = COALESCE(?, cwd), updated_at = ? WHERE task_id = ?`,
      )
      .run(
        input.repoOwner,
        input.repoName,
        input.cwd || null,
        iso_timestamp(),
        input.taskId,
      );
    return result.changes > 0
      ? success(undefined)
      : failure(`Task 不存在: ${input.taskId}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`更新 Task 仓库信息失败: ${message}`);
  }
}

function runRequestPlanTxn(
  db: ReturnType<typeof getDb> extends { success: true; data: infer D }
    ? D
    : never,
  taskId: string,
  threadId: string,
  now: string,
) {
  db.prepare(
    'UPDATE task_items SET current_workflow_kind = ?, lifecycle = ?, updated_at = ? WHERE task_id = ?',
  ).run(WORKFLOW_KIND.PLAN, LIFECYCLE.ACTIVE, now, taskId);
  db.prepare(
    'UPDATE task_threads SET purpose = ?, status = ?, updated_at = ? WHERE thread_id = ?',
  ).run(THREAD_PURPOSE.PLANNING, THREAD_STATUS.DRAFTING, now, threadId);
}

export function requestTaskPlan(taskId: string): Result<void> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${taskId}`);
  if (snapshot.task.lifecycle === LIFECYCLE.DONE)
    return failure('Task 已关闭，不能转为计划');
  if (snapshot.task.currentWorkflowKind !== WORKFLOW_KIND.PLAN)
    return success(undefined);

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const now = iso_timestamp();
    dbRes.data.transaction(() =>
      runRequestPlanTxn(dbRes.data, taskId, snapshot.thread.threadId, now),
    )();
    return success(undefined);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`转为计划失败: ${message}`);
  }
}
