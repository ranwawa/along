import type { Database } from 'bun:sqlite';
import { iso_timestamp } from '../../core/common';
import { getDb } from '../../core/db';
import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import {
  EXEC_STEPS_APPROVAL_KIND,
  findExecStepsApprovalArtifact,
  findExecStepsArtifact,
} from '../task/exec-steps';
import { insertArtifact } from './artifact';
import { hasDeliveryResult } from './flow';
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

function runApprovePlanTxn(
  db: Database,
  snapshot: TaskPlanningSnapshot,
  now: string,
) {
  insertArtifact({
    taskId: snapshot.task.taskId,
    threadId: snapshot.thread.threadId,
    type: ARTIFACT_TYPE.APPROVAL,
    role: ARTIFACT_ROLE.USER,
    body: `Approved Plan v${snapshot.currentPlan?.version}`,
    metadata: { planId: snapshot.currentPlan?.planId },
    createdAt: now,
  });
  db.prepare('UPDATE task_plan_revisions SET status = ? WHERE plan_id = ?').run(
    PLAN_STATUS.APPROVED,
    snapshot.currentPlan?.planId,
  );
  db.prepare(
    'UPDATE task_threads SET status = ?, approved_plan_id = ?, updated_at = ? WHERE thread_id = ?',
  ).run(
    THREAD_STATUS.IMPLEMENTING,
    snapshot.currentPlan?.planId,
    now,
    snapshot.thread.threadId,
  );
  db.prepare(
    'UPDATE task_items SET lifecycle = ?, current_workflow_kind = ?, updated_at = ? WHERE task_id = ?',
  ).run(LIFECYCLE.ACTIVE, WORKFLOW_KIND.EXEC, now, snapshot.task.taskId);
}

export function approveCurrentTaskPlan(
  taskId: string,
): Result<TaskPlanRevisionRecord> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${taskId}`);
  const openRes = ensureTaskIsOpen(snapshot, '批准计划');
  if (!openRes.success) return openRes;
  if (!snapshot.currentPlan) return failure('当前没有可批准的正式 Plan');
  if (snapshot.openRound)
    return failure(`当前仍有待处理反馈轮次: ${snapshot.openRound.roundId}`);
  if (snapshot.currentPlan.status !== PLAN_STATUS.ACTIVE)
    return failure('只能批准当前 active Plan');

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  try {
    const now = iso_timestamp();
    dbRes.data.transaction(() =>
      runApprovePlanTxn(dbRes.data, snapshot, now),
    )();
    return success({ ...snapshot.currentPlan, status: PLAN_STATUS.APPROVED });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`批准 Task Plan 失败: ${message}`);
  }
}

import type { TaskPlanRevisionRecord as PlanRecord } from './records';

function findApprovedPlanAndSteps(snapshot: TaskPlanningSnapshot): Result<{
  approvedPlan: PlanRecord;
  steps: TaskArtifactRecord;
  existingApproval: TaskArtifactRecord | undefined;
}> {
  const approvedPlan = snapshot.plans.find(
    (plan) =>
      plan.planId === snapshot.thread.approvedPlanId &&
      plan.status === PLAN_STATUS.APPROVED,
  );
  if (!approvedPlan)
    return failure('当前 Task 没有已批准方案，不能确认实施步骤');
  const steps = findExecStepsArtifact(snapshot, approvedPlan);
  if (!steps) return failure('当前 Task 还没有可确认的实施步骤');
  const existingApproval =
    findExecStepsApprovalArtifact(snapshot, approvedPlan) || undefined;
  return success({ approvedPlan, steps, existingApproval });
}

function insertExecStepsApproval(
  snapshot: TaskPlanningSnapshot,
  approvedPlan: PlanRecord,
  steps: TaskArtifactRecord,
  now: string,
): TaskArtifactRecord | null {
  const dbRes = getDb();
  if (!dbRes.success) return null;
  let artifact: TaskArtifactRecord | null = null;
  dbRes.data.transaction(() => {
    artifact = insertArtifact({
      taskId: snapshot.task.taskId,
      threadId: snapshot.thread.threadId,
      type: ARTIFACT_TYPE.APPROVAL,
      role: ARTIFACT_ROLE.USER,
      body: `Approved Exec Steps for Plan v${approvedPlan.version}`,
      metadata: {
        kind: EXEC_STEPS_APPROVAL_KIND,
        planId: approvedPlan.planId,
        stepsArtifactId: steps.artifactId,
      },
      createdAt: now,
    });
    dbRes.data
      .prepare('UPDATE task_items SET updated_at = ? WHERE task_id = ?')
      .run(now, snapshot.task.taskId);
  })();
  return artifact;
}

export function approveTaskExecSteps(
  taskId: string,
): Result<TaskArtifactRecord> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${taskId}`);
  const openRes = ensureTaskIsOpen(snapshot, '确认实施步骤');
  if (!openRes.success) return openRes;

  const findRes = findApprovedPlanAndSteps(snapshot);
  if (!findRes.success) return findRes;
  const { approvedPlan, steps, existingApproval } = findRes.data;
  if (existingApproval?.metadata.stepsArtifactId === steps.artifactId)
    return success(existingApproval);

  try {
    const now = iso_timestamp();
    const artifact = insertExecStepsApproval(
      snapshot,
      approvedPlan,
      steps,
      now,
    );
    return artifact
      ? success(artifact)
      : failure('确认实施步骤后缺少 artifact');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`确认实施步骤失败: ${message}`);
  }
}

function runCompleteDeliveryTxn(
  db: Database,
  snapshot: TaskPlanningSnapshot,
  now: string,
) {
  insertArtifact({
    taskId: snapshot.task.taskId,
    threadId: snapshot.thread.threadId,
    type: ARTIFACT_TYPE.APPROVAL,
    role: ARTIFACT_ROLE.USER,
    body: '交付已验收，任务完成。',
    metadata: {
      kind: 'delivery_acceptance',
      prUrl: snapshot.task.prUrl,
      prNumber: snapshot.task.prNumber,
      workspaceMode: snapshot.task.workspaceMode,
    },
    createdAt: now,
  });
  db.prepare(
    'UPDATE task_items SET lifecycle = ?, current_workflow_kind = ?, updated_at = ? WHERE task_id = ?',
  ).run(LIFECYCLE.DONE, WORKFLOW_KIND.EXEC, now, snapshot.task.taskId);
}

export function completeDeliveredTask(
  taskId: string,
): Result<TaskPlanningSnapshot> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${taskId}`);
  const openRes = ensureTaskIsOpen(snapshot, '验收完成');
  if (!openRes.success) return openRes;
  if (snapshot.task.lifecycle === LIFECYCLE.DONE) return success(snapshot);
  if (!hasDeliveryResult(snapshot.task))
    return failure('只有已交付 Task 可以验收完成');

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  try {
    const now = iso_timestamp();
    dbRes.data.transaction(() =>
      runCompleteDeliveryTxn(dbRes.data, snapshot, now),
    )();
    const refreshedRes = readTaskPlanningSnapshot(taskId);
    if (!refreshedRes.success) return refreshedRes;
    return refreshedRes.data
      ? success(refreshedRes.data)
      : failure(`Task ${taskId} 验收后读取快照失败`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`完成 Task 失败: ${message}`);
  }
}
