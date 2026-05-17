import type { Database } from 'bun:sqlite';
import { iso_timestamp } from '../../core/common';
import { getDb } from '../../core/db';
import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import { insertArtifact } from './artifact';
import type { UpdatePlanningTaskTitleInput } from './inputs';
import { readTaskPlanningSnapshot } from './read';
import type { TaskPlanningSnapshot } from './records';
import {
  AGENT_RUN_STATUS,
  ARTIFACT_ROLE,
  ARTIFACT_TYPE,
  LIFECYCLE,
  ROUND_STATUS,
} from './types';

export function deleteTask(taskId: string): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;
  const existing = db
    .prepare('SELECT task_id FROM task_items WHERE task_id = ?')
    .get(taskId) as { task_id: string } | undefined;
  if (!existing) return failure(`Task 不存在: ${taskId}`);
  db.prepare('DELETE FROM task_items WHERE task_id = ?').run(taskId);
  return success(undefined);
}

function closeTaskRuns(
  db: Database,
  snapshot: TaskPlanningSnapshot,
  now: string,
) {
  for (const run of snapshot.agentRuns.filter(
    (r) => r.status === AGENT_RUN_STATUS.RUNNING,
  )) {
    db.prepare(
      `UPDATE task_agent_runs SET status = ?, output_artifact_ids = ?, error = ?, ended_at = ? WHERE run_id = ? AND status = ?`,
    ).run(
      AGENT_RUN_STATUS.CANCELLED,
      JSON.stringify(run.outputArtifactIds),
      '任务已关闭，运行已取消。',
      now,
      run.runId,
      AGENT_RUN_STATUS.RUNNING,
    );
  }
}

function insertCloseArtifact(
  snapshot: TaskPlanningSnapshot,
  closeReason: string | undefined,
  now: string,
) {
  insertArtifact({
    taskId: snapshot.task.taskId,
    threadId: snapshot.thread.threadId,
    type: ARTIFACT_TYPE.TASK_CLOSED,
    role: ARTIFACT_ROLE.SYSTEM,
    body: closeReason
      ? `任务已关闭：${closeReason}`
      : '任务已关闭，不再继续推进。',
    metadata: {
      previousLifecycle: snapshot.task.lifecycle,
      previousWorkflowKind: snapshot.task.currentWorkflowKind,
      previousThreadStatus: snapshot.thread.status,
      reason: closeReason || null,
      closedAt: now,
    },
    createdAt: now,
  });
}

function runCloseTaskTxn(
  db: Database,
  snapshot: TaskPlanningSnapshot,
  closeReason: string | undefined,
  now: string,
) {
  insertCloseArtifact(snapshot, closeReason, now);
  if (snapshot.openRound) {
    db.prepare(
      'UPDATE task_feedback_rounds SET status = ?, resolved_at = ? WHERE round_id = ?',
    ).run(ROUND_STATUS.CLOSED, now, snapshot.openRound.roundId);
  }
  db.prepare(
    'UPDATE task_threads SET open_round_id = NULL, updated_at = ? WHERE thread_id = ?',
  ).run(now, snapshot.thread.threadId);
  closeTaskRuns(db, snapshot, now);
  db.prepare(
    'UPDATE task_items SET lifecycle = ?, current_workflow_kind = ?, updated_at = ? WHERE task_id = ?',
  ).run(
    LIFECYCLE.DONE,
    snapshot.task.currentWorkflowKind,
    now,
    snapshot.task.taskId,
  );
}

export function closeTask(
  taskId: string,
  reason?: string,
): Result<TaskPlanningSnapshot> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${taskId}`);
  if (snapshot.task.lifecycle === LIFECYCLE.DONE) return success(snapshot);

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  try {
    const now = iso_timestamp();
    const closeReason = reason?.trim();
    dbRes.data.transaction(() =>
      runCloseTaskTxn(dbRes.data, snapshot, closeReason, now),
    )();
    const refreshedRes = readTaskPlanningSnapshot(taskId);
    if (!refreshedRes.success) return refreshedRes;
    return refreshedRes.data
      ? success(refreshedRes.data)
      : failure(`Task ${taskId} 关闭后读取快照失败`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`关闭 Task 失败: ${message}`);
  }
}

export function updatePlanningTaskTitle(
  input: UpdatePlanningTaskTitleInput,
): Result<TaskPlanningSnapshot | null> {
  const title = input.title.trim();
  if (!title) return failure('Task 标题不能为空');

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  try {
    const now = iso_timestamp();
    dbRes.data
      .prepare(
        'UPDATE task_items SET title = ?, updated_at = ? WHERE task_id = ?',
      )
      .run(title, now, input.taskId);
    return readTaskPlanningSnapshot(input.taskId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`更新 Task 标题失败: ${message}`);
  }
}
