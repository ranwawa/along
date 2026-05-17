import type { Database } from 'bun:sqlite';
import { iso_timestamp } from '../../core/common';
import { getDb } from '../../core/db';
import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import { insertArtifact } from './artifact';
import { generateId } from './db-utils';
import { hasDeliveryResult } from './flow';
import type {
  PublishPlanningUpdateInput,
  PublishTaskPlanInput,
} from './inputs';
import { readTaskPlanningSnapshot } from './read';
import type {
  TaskArtifactRecord,
  TaskPlanningSnapshot,
  TaskPlanRevisionRecord,
} from './records';
import {
  ARTIFACT_ROLE,
  ARTIFACT_TYPE,
  LIFECYCLE,
  PLAN_STATUS,
  ROUND_RESOLUTION,
  ROUND_STATUS,
  TASK_AGENT_ID,
  THREAD_STATUS,
  WORKFLOW_KIND,
} from './types';

function ensureTaskIsOpen(
  snapshot: { task: { lifecycle: string } },
  action: string,
): Result<void> {
  return snapshot.task.lifecycle === LIFECYCLE.DONE
    ? failure(`Task 已关闭，不能${action}`)
    : success(undefined);
}

function insertPlanRevisionRow(
  db: Database,
  snapshot: TaskPlanningSnapshot,
  planId: string,
  artifactId: string,
  body: string,
  nextVersion: number,
  now: string,
) {
  db.prepare(
    'UPDATE task_plan_revisions SET status = ? WHERE thread_id = ? AND status = ?',
  ).run(PLAN_STATUS.SUPERSEDED, snapshot.thread.threadId, PLAN_STATUS.ACTIVE);
  db.prepare(
    `INSERT INTO task_plan_revisions (plan_id, task_id, thread_id, version, based_on_plan_id, status, artifact_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    planId,
    snapshot.task.taskId,
    snapshot.thread.threadId,
    nextVersion,
    snapshot.currentPlan?.planId || null,
    PLAN_STATUS.ACTIVE,
    artifactId,
    body,
    now,
  );
  if (snapshot.openRound) {
    db.prepare(
      'UPDATE task_feedback_rounds SET status = ?, resolution = ?, produced_plan_id = ?, resolved_at = ? WHERE round_id = ?',
    ).run(
      ROUND_STATUS.RESOLVED,
      ROUND_RESOLUTION.REVISE_PLAN,
      planId,
      now,
      snapshot.openRound.roundId,
    );
  }
  db.prepare(
    'UPDATE task_threads SET status = ?, current_plan_id = ?, open_round_id = NULL, updated_at = ? WHERE thread_id = ?',
  ).run(THREAD_STATUS.AWAITING_APPROVAL, planId, now, snapshot.thread.threadId);
}

function insertPlanArtifact(
  snapshot: TaskPlanningSnapshot,
  input: PublishTaskPlanInput,
  body: string,
  nextVersion: number,
  now: string,
) {
  return insertArtifact({
    taskId: snapshot.task.taskId,
    threadId: snapshot.thread.threadId,
    type: ARTIFACT_TYPE.PLAN_REVISION,
    role: ARTIFACT_ROLE.AGENT,
    body,
    metadata: {
      agentId: input.agentId || TASK_AGENT_ID.PLANNING,
      version: nextVersion,
      basedOnPlanId: snapshot.currentPlan?.planId,
      roundId: snapshot.openRound?.roundId,
      ...(input.metadata || {}),
    },
    createdAt: now,
  });
}

function runPublishPlanTxn(
  db: Database,
  snapshot: TaskPlanningSnapshot,
  input: PublishTaskPlanInput,
  body: string,
  now: string,
): TaskPlanRevisionRecord {
  const nextVersion = snapshot.plans.length + 1;
  const planId = generateId('plan');
  const artifact = insertPlanArtifact(snapshot, input, body, nextVersion, now);
  insertPlanRevisionRow(
    db,
    snapshot,
    planId,
    artifact.artifactId,
    body,
    nextVersion,
    now,
  );
  db.prepare(
    'UPDATE task_items SET type = COALESCE(?, type), updated_at = ? WHERE task_id = ?',
  ).run(input.type || null, now, snapshot.task.taskId);
  return {
    planId,
    taskId: snapshot.task.taskId,
    threadId: snapshot.thread.threadId,
    version: nextVersion,
    basedOnPlanId: snapshot.currentPlan?.planId,
    status: PLAN_STATUS.ACTIVE,
    artifactId: artifact.artifactId,
    body,
    createdAt: now,
  };
}

export function publishTaskPlanRevision(
  input: PublishTaskPlanInput,
): Result<TaskPlanRevisionRecord> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;
  const body = input.body.trim();
  if (!body) return failure('Plan 内容不能为空');

  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${input.taskId}`);
  const openRes = ensureTaskIsOpen(snapshot, '发布新版 Plan');
  if (!openRes.success) return openRes;
  if (snapshot.thread.status === THREAD_STATUS.APPROVED)
    return failure('当前 Planning 已批准，不能发布新版 Plan');
  if (snapshot.currentPlan && !snapshot.openRound)
    return failure('当前没有待处理反馈，不能覆盖现有 Plan');

  try {
    const now = iso_timestamp();
    let plan: TaskPlanRevisionRecord | null = null;
    db.transaction(() => {
      plan = runPublishPlanTxn(db, snapshot, input, body, now);
    })();
    return plan ? success(plan) : failure('发布 Plan 后缺少结果');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`发布 Task Plan 失败: ${message}`);
  }
}

function updateThreadAfterUpdate(
  db: Database,
  snapshot: TaskPlanningSnapshot,
  now: string,
) {
  if (snapshot.openRound) {
    db.prepare(
      'UPDATE task_feedback_rounds SET status = ?, resolution = ?, resolved_at = ? WHERE round_id = ?',
    ).run(
      ROUND_STATUS.RESOLVED,
      ROUND_RESOLUTION.ANSWER_ONLY,
      now,
      snapshot.openRound.roundId,
    );
    db.prepare(
      'UPDATE task_threads SET status = ?, open_round_id = NULL, updated_at = ? WHERE thread_id = ?',
    ).run(THREAD_STATUS.AWAITING_APPROVAL, now, snapshot.thread.threadId);
  } else {
    const status =
      snapshot.task.currentWorkflowKind === WORKFLOW_KIND.PLAN
        ? THREAD_STATUS.ANSWERED
        : THREAD_STATUS.DISCUSSING;
    db.prepare(
      'UPDATE task_threads SET status = ?, updated_at = ? WHERE thread_id = ?',
    ).run(status, now, snapshot.thread.threadId);
  }
}

function runPublishUpdateTxn(
  db: Database,
  snapshot: TaskPlanningSnapshot,
  input: PublishPlanningUpdateInput,
  body: string,
  now: string,
): TaskArtifactRecord {
  const artifact = insertArtifact({
    taskId: snapshot.task.taskId,
    threadId: snapshot.thread.threadId,
    type: ARTIFACT_TYPE.PLANNING_UPDATE,
    role: ARTIFACT_ROLE.AGENT,
    body,
    metadata: {
      agentId: input.agentId || TASK_AGENT_ID.PLANNING,
      roundId: snapshot.openRound?.roundId,
      basedOnPlanId: snapshot.currentPlan?.planId,
      kind:
        input.kind ||
        (snapshot.currentPlan ? 'answer_only' : 'pre_plan_clarification'),
    },
    createdAt: now,
  });
  updateThreadAfterUpdate(db, snapshot, now);
  db.prepare('UPDATE task_items SET updated_at = ? WHERE task_id = ?').run(
    now,
    snapshot.task.taskId,
  );
  return artifact;
}

export function publishPlanningUpdate(
  input: PublishPlanningUpdateInput,
): Result<TaskArtifactRecord> {
  const body = input.body.trim();
  if (!body) return failure('Planning Update 内容不能为空');

  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${input.taskId}`);
  const openRes = ensureTaskIsOpen(snapshot, '发布 Update');
  if (!openRes.success) return openRes;
  if (snapshot.thread.status === THREAD_STATUS.APPROVED)
    return failure('当前 Planning 已批准，不能发布 Update');
  if (snapshot.currentPlan && !snapshot.openRound)
    return failure('当前没有待处理反馈，无法发布 Update');

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;
  try {
    const now = iso_timestamp();
    let artifact: TaskArtifactRecord | null = null;
    db.transaction(() => {
      artifact = runPublishUpdateTxn(db, snapshot, input, body, now);
    })();
    return artifact ? success(artifact) : failure('发布 Update 后缺少结果');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`发布 Planning Update 失败: ${message}`);
  }
}

export { hasDeliveryResult };
