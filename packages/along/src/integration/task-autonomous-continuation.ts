import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  areImplementationStepsApproved,
  findImplementationStepsArtifact,
} from '../domain/task-implementation-steps';
import {
  approveCurrentTaskPlan,
  approveTaskImplementationSteps,
  PLAN_STATUS,
  readTaskPlanningSnapshot,
  TASK_EXECUTION_MODE,
  TASK_LIFECYCLE,
  type TaskPlanningSnapshot,
  WORKFLOW_KIND,
} from '../domain/task-planning';
import type {
  ScheduledTaskDeliveryRun,
  ScheduledTaskImplementationRun,
} from './task-api';

export type AutonomousContinuationAction =
  | 'skipped'
  | 'approved_plan'
  | 'approved_implementation_steps'
  | 'scheduled_delivery';

export interface TaskAutonomousContinuationSchedulers {
  scheduleImplementation?: (input: ScheduledTaskImplementationRun) => void;
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
  return snapshot.task.lifecycle === TASK_LIFECYCLE.CANCELLED;
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
  if (!input.scheduleImplementation) {
    return failure('Implementation 调度器未启用，无法自动推进');
  }

  const approveRes = approveCurrentTaskPlan(input.taskId);
  if (!approveRes.success) return approveRes;
  input.scheduleImplementation({
    taskId: input.taskId,
    cwd: input.cwd,
    reason: 'autonomous',
  });
  return success('approved_plan');
}

export function continueAutonomousTaskAfterImplementation(
  input: TaskAutonomousContinuationInput,
): Result<AutonomousContinuationAction> {
  const snapshotRes = readRequiredSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (isClosed(snapshot)) return success('skipped');
  if (!isAutonomous(snapshot)) return success('skipped');

  if (snapshot.task.currentWorkflowKind === WORKFLOW_KIND.PLANNING) {
    return continueAfterImplementationSteps(input, snapshot);
  }
  if (
    snapshot.task.currentWorkflowKind === WORKFLOW_KIND.IMPLEMENTATION &&
    snapshot.task.lifecycle === TASK_LIFECYCLE.READY
  ) {
    return continueAfterImplemented(input, snapshot);
  }
  return success('skipped');
}

function continueAfterImplementationSteps(
  input: TaskAutonomousContinuationInput,
  snapshot: TaskPlanningSnapshot,
): Result<AutonomousContinuationAction> {
  const approvedPlan = snapshot.plans.find(
    (plan) =>
      plan.planId === snapshot.thread.approvedPlanId &&
      plan.status === PLAN_STATUS.APPROVED,
  );
  if (!approvedPlan) return success('skipped');
  if (!findImplementationStepsArtifact(snapshot, approvedPlan)) {
    return success('skipped');
  }
  if (areImplementationStepsApproved(snapshot, approvedPlan)) {
    return success('skipped');
  }
  if (!input.scheduleImplementation) {
    return failure('Implementation 调度器未启用，无法自动推进');
  }

  const approveRes = approveTaskImplementationSteps(input.taskId);
  if (!approveRes.success) return approveRes;
  input.scheduleImplementation({
    taskId: input.taskId,
    cwd: input.cwd,
    reason: 'autonomous',
  });
  return success('approved_implementation_steps');
}

function continueAfterImplemented(
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
