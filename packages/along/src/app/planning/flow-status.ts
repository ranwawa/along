import {
  deriveTaskDisplay,
  type TaskDisplay,
} from '../../domain/workflow/display-state';
import type { WorkflowRuntimeState } from '../../domain/workflow/state';
import {
  LIFECYCLE,
  TASK_STATUS,
  TASK_WORKSPACE_MODE,
  type TaskAgentStageRecord,
  type TaskFeedbackRoundRecord,
  type TaskItemRecord,
  type TaskPlanRevisionRecord,
  type TaskStatus,
  type TaskThreadRecord,
  THREAD_STATUS,
  WORKFLOW_KIND,
} from './';

export function isTaskCancelled(task: TaskItemRecord): boolean {
  return task.lifecycle === LIFECYCLE.DONE;
}

export function isTaskCompleted(task: TaskItemRecord): boolean {
  return task.lifecycle === LIFECYCLE.DONE;
}

export function hasDeliveryResult(
  task: Pick<TaskItemRecord, 'prUrl' | 'workspaceMode'>,
): boolean {
  return (
    Boolean(task.prUrl) ||
    task.workspaceMode === TASK_WORKSPACE_MODE.DEFAULT_BRANCH
  );
}

export function isTaskDelivered(task: TaskItemRecord): boolean {
  return (
    task.lifecycle === LIFECYCLE.WAITING &&
    task.currentWorkflowKind === WORKFLOW_KIND.EXEC &&
    hasDeliveryResult(task)
  );
}

export function isTaskImplemented(task: TaskItemRecord): boolean {
  return (
    task.lifecycle === LIFECYCLE.WAITING &&
    task.currentWorkflowKind === WORKFLOW_KIND.EXEC
  );
}

export function isTaskDelivering(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
}): boolean {
  return (
    input.task.lifecycle === LIFECYCLE.ACTIVE &&
    input.task.currentWorkflowKind === WORKFLOW_KIND.EXEC &&
    input.thread.status === THREAD_STATUS.VERIFYING
  );
}

export function isTaskExecing(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
}): boolean {
  return (
    input.task.lifecycle === LIFECYCLE.ACTIVE &&
    input.task.currentWorkflowKind === WORKFLOW_KIND.EXEC &&
    input.thread.status !== THREAD_STATUS.VERIFYING
  );
}

export function isPlanningApproved(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
}): boolean {
  return (
    input.task.lifecycle === LIFECYCLE.ACTIVE &&
    input.task.currentWorkflowKind === WORKFLOW_KIND.PLAN &&
    Boolean(input.thread.approvedPlanId)
  );
}

export function isPlanningActive(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
}): boolean {
  return (
    input.task.currentWorkflowKind === WORKFLOW_KIND.PLAN &&
    !isPlanningApproved(input)
  );
}

export function deriveTaskStatusFromWorkflow(
  workflow: WorkflowRuntimeState,
  _task?: Pick<TaskItemRecord, 'prUrl' | 'workspaceMode'>,
): TaskStatus {
  if (workflow.lifecycle === LIFECYCLE.DONE) return TASK_STATUS.CLOSED;
  if (workflow.lifecycle === LIFECYCLE.FAILED) return TASK_STATUS.IMPLEMENTING;
  if (workflow.currentWorkflowKind === WORKFLOW_KIND.EXEC) {
    if (workflow.workflowState === 'verifying') return TASK_STATUS.DELIVERING;
    if (workflow.workflowState === 'implemented') return TASK_STATUS.DELIVERED;
    return TASK_STATUS.IMPLEMENTING;
  }
  if (workflow.workflowState === 'awaiting_approval') {
    return TASK_STATUS.PLANNING_APPROVED;
  }
  return TASK_STATUS.PLANNING;
}

export function applyWorkflowView(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  agentStages: TaskAgentStageRecord[];
}): {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  display: TaskDisplay;
  workflow: WorkflowRuntimeState;
} {
  const workflow: WorkflowRuntimeState = {
    lifecycle: input.task.lifecycle,
    currentWorkflowKind: input.task.currentWorkflowKind,
    workflowState:
      (input.thread.status as WorkflowRuntimeState['workflowState']) ||
      'drafting',
  };
  return {
    task: {
      ...input.task,
      status: deriveTaskStatusFromWorkflow(workflow, input.task),
    },
    thread: input.thread,
    display: deriveTaskDisplay(workflow),
    workflow,
  };
}

const MINUTES_PER_HOUR = 60;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const LONG_RUNNING_MINUTES = 30;
export const LONG_RUNNING_THRESHOLD_MS =
  LONG_RUNNING_MINUTES * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

export function isLongRunning(run: { startedAt: string }): boolean {
  const startedAt = new Date(run.startedAt).getTime();
  if (Number.isNaN(startedAt)) return false;
  return Date.now() - startedAt > LONG_RUNNING_THRESHOLD_MS;
}
