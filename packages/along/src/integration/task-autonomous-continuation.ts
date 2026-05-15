import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  areExecStepsApproved,
  findExecStepsArtifact,
} from '../domain/task-exec-steps';
import {
  approveCurrentTaskPlan,
  approveTaskExecSteps,
  LIFECYCLE,
  PLAN_STATUS,
  readTaskPlanningSnapshot,
  TASK_EXECUTION_MODE,
  type TaskPlanningSnapshot,
  WORKFLOW_KIND,
} from '../domain/task-planning';
import type {
  ScheduledTaskDeliveryRun,
  ScheduledTaskExecRun,
} from './task-api';

export type AutonomousContinuationAction =
  | 'skipped'
  | 'approved_plan'
  | 'approved_exec_steps'
  | 'scheduled_delivery';

export interface TaskAutonomousContinuationSchedulers {
  scheduleExec?: (input: ScheduledTaskExecRun) => void;
  scheduleDelivery?: (input: ScheduledTaskDeliveryRun) => void;
}

export interface TaskAutonomousContinuationInput
  extends TaskAutonomousContinuationSchedulers {
  taskId: string;
  cwd: string;
}

function readRequiredSnapshot(taskId: string): Result<TaskPlanningSnapshot> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return snapshotRes;
  if (!snapshotRes.data) return failure(`Task 不存在: ${taskId}`);
  return success(snapshotRes.data);
}

function isAutonomous(snapshot: TaskPlanningSnapshot): boolean {
  return snapshot.task.executionMode === TASK_EXECUTION_MODE.AUTONOMOUS;
}

function hasApprovedThread(snapshot: TaskPlanningSnapshot): boolean {
  return Boolean(snapshot.thread.approvedPlanId);
}

function isClosed(snapshot: TaskPlanningSnapshot): boolean {
  return snapshot.task.lifecycle === LIFECYCLE.DONE;
}

export function continueAutonomousTaskAfterPlanning(
  input: TaskAutonomousContinuationInput & { plannerAction: string },
): Result<AutonomousContinuationAction> {
  if (input.plannerAction !== 'plan_revision') return success('skipped');

  const snapshotRes = readRequiredSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (isClosed(snapshot)) return success('skipped');
  if (!isAutonomous(snapshot)) return success('skipped');
  if (
    !snapshot.currentPlan ||
    snapshot.currentPlan.status !== PLAN_STATUS.ACTIVE ||
    snapshot.openRound ||
    hasApprovedThread(snapshot)
  ) {
    return success('skipped');
  }
  if (!input.scheduleExec) {
    return failure('Exec 调度器未启用，无法自动推进');
  }

  const approveRes = approveCurrentTaskPlan(input.taskId);
  if (!approveRes.success) return approveRes;
  input.scheduleExec({
    taskId: input.taskId,
    cwd: input.cwd,
    reason: 'autonomous',
  });
  return success('approved_plan');
}

export function continueAutonomousTaskAfterExec(
  input: TaskAutonomousContinuationInput,
): Result<AutonomousContinuationAction> {
  const snapshotRes = readRequiredSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (isClosed(snapshot)) return success('skipped');
  if (!isAutonomous(snapshot)) return success('skipped');

  if (snapshot.task.currentWorkflowKind === WORKFLOW_KIND.PLAN) {
    return continueAfterExecSteps(input, snapshot);
  }
  if (
    snapshot.task.currentWorkflowKind === WORKFLOW_KIND.EXEC &&
    snapshot.task.lifecycle === LIFECYCLE.ACTIVE
  ) {
    return continueAfterExecCompleted(input, snapshot);
  }
  return success('skipped');
}

function continueAfterExecSteps(
  input: TaskAutonomousContinuationInput,
  snapshot: TaskPlanningSnapshot,
): Result<AutonomousContinuationAction> {
  const approvedPlan = snapshot.plans.find(
    (plan) =>
      plan.planId === snapshot.thread.approvedPlanId &&
      plan.status === PLAN_STATUS.APPROVED,
  );
  if (!approvedPlan) return success('skipped');
  if (!findExecStepsArtifact(snapshot, approvedPlan)) {
    return success('skipped');
  }
  if (areExecStepsApproved(snapshot, approvedPlan)) {
    return success('skipped');
  }
  if (!input.scheduleExec) {
    return failure('Exec 调度器未启用，无法自动推进');
  }

  const approveRes = approveTaskExecSteps(input.taskId);
  if (!approveRes.success) return approveRes;
  input.scheduleExec({
    taskId: input.taskId,
    cwd: input.cwd,
    reason: 'autonomous',
  });
  return success('approved_exec_steps');
}

function continueAfterExecCompleted(
  input: TaskAutonomousContinuationInput,
  snapshot: TaskPlanningSnapshot,
): Result<AutonomousContinuationAction> {
  if (snapshot.task.prUrl || snapshot.task.commitShas.length === 0) {
    return success('skipped');
  }
  if (!input.scheduleDelivery) {
    return failure('Delivery 调度器未启用，无法自动推进');
  }
  input.scheduleDelivery({
    taskId: input.taskId,
    cwd: input.cwd,
    reason: 'autonomous',
  });
  return success('scheduled_delivery');
}
