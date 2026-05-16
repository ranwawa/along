import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import { requestTaskAgentCancellation } from '../domain/task-agent-run-lifecycle';
import {
  areExecStepsApproved,
  findExecStepsArtifact,
} from '../domain/task-exec-steps';
import {
  approveCurrentTaskPlan,
  approveTaskExecSteps,
  cancelTaskAgentRun,
  closeTask,
  completeDeliveredTask,
  completeTaskAgentStageManually,
  deleteTask,
  LIFECYCLE,
  readTaskPlanningSnapshot,
  requestTaskPlan,
  TASK_WORKSPACE_MODE,
  type TaskPlanningSnapshot,
  WORKFLOW_KIND,
} from '../domain/task-planning';
import {
  HTTP_ACCEPTED,
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_SERVICE_UNAVAILABLE,
} from './http-status';
import type { TaskApiContext } from './task-api';
import { readOptionalJsonObject } from './task-api-handlers';
import {
  scheduleDeliveryIfNeeded,
  scheduleExecIfNeeded,
  schedulePlannerIfNeeded,
} from './task-api-scheduler';
import {
  errorResponse,
  jsonResponse,
  readBooleanField,
  readJsonObject,
  readOptionalPositiveIntField,
  readStringField,
  readTaskAgentStageField,
  type UnknownRecord,
} from './task-api-utils';

export function handleTaskApproveRequest(taskId: string): Response {
  const approveRes = approveCurrentTaskPlan(taskId);
  if (!approveRes.success)
    return errorResponse(approveRes.error, HTTP_CONFLICT);

  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success)
    return errorResponse(snapshotRes.error, HTTP_INTERNAL_SERVER_ERROR);

  return jsonResponse({
    taskId,
    approvedPlan: approveRes.data,
    snapshot: snapshotRes.data,
  });
}

export async function handleTaskCloseRequest(
  req: Request,
  taskId: string,
): Promise<Response> {
  const bodyRes = await readJsonObject(req);
  if (!bodyRes.success) return errorResponse(bodyRes.error, HTTP_BAD_REQUEST);

  const existing = readTaskPlanningSnapshot(taskId);
  if (!existing.success)
    return errorResponse(existing.error, HTTP_INTERNAL_SERVER_ERROR);
  if (!existing.data)
    return errorResponse(`Task 不存在: ${taskId}`, HTTP_NOT_FOUND);

  const closeRes = closeTask(taskId, readStringField(bodyRes.data, 'reason'));
  if (!closeRes.success) return errorResponse(closeRes.error, HTTP_CONFLICT);
  return jsonResponse({ taskId, snapshot: closeRes.data });
}

export async function handleTaskCancelAgentRequest(
  req: Request,
  taskId: string,
): Promise<Response> {
  const bodyRes = await readOptionalJsonObject(req);
  if (!bodyRes.success) return errorResponse(bodyRes.error, HTTP_BAD_REQUEST);

  const existing = readTaskPlanningSnapshot(taskId);
  if (!existing.success)
    return errorResponse(existing.error, HTTP_INTERNAL_SERVER_ERROR);
  if (!existing.data)
    return errorResponse(`Task 不存在: ${taskId}`, HTTP_NOT_FOUND);

  const cancelRes = cancelTaskAgentRun({
    taskId,
    runId: readStringField(bodyRes.data, 'runId'),
    reason: readStringField(bodyRes.data, 'reason'),
  });
  if (!cancelRes.success) return errorResponse(cancelRes.error, HTTP_CONFLICT);
  if (cancelRes.data.runId) {
    requestTaskAgentCancellation(
      cancelRes.data.runId,
      readStringField(bodyRes.data, 'reason'),
    );
  }

  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success)
    return errorResponse(snapshotRes.error, HTTP_INTERNAL_SERVER_ERROR);
  return jsonResponse({
    taskId,
    cancelled: cancelRes.data.cancelled,
    runId: cancelRes.data.runId,
    snapshot: snapshotRes.data || existing.data,
  });
}

export async function handleTaskPlannerRequest(
  req: Request,
  taskId: string,
  context: TaskApiContext,
): Promise<Response> {
  const bodyRes = await readJsonObject(req);
  if (!bodyRes.success) return errorResponse(bodyRes.error, HTTP_BAD_REQUEST);
  const snapshotError = readExistingTaskError(taskId);
  if (snapshotError) return snapshotError;
  const requestPlanRes = requestTaskPlan(taskId);
  if (!requestPlanRes.success)
    return errorResponse(requestPlanRes.error, HTTP_CONFLICT);

  const scheduledRes = schedulePlannerIfNeeded(
    { ...bodyRes.data, autoRun: true },
    context,
    { taskId, reason: 'manual' },
  );
  if (!scheduledRes.success)
    return errorResponse(scheduledRes.error, HTTP_BAD_REQUEST);
  if (!scheduledRes.data)
    return errorResponse('Planner 调度器未启用', HTTP_SERVICE_UNAVAILABLE);

  return jsonResponse({ taskId, scheduled: true }, HTTP_ACCEPTED);
}

export async function handleTaskExecRequest(
  req: Request,
  taskId: string,
  context: TaskApiContext,
): Promise<Response> {
  const bodyRes = await readJsonObject(req);
  if (!bodyRes.success) return errorResponse(bodyRes.error, HTTP_BAD_REQUEST);
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success)
    return errorResponse(snapshotRes.error, HTTP_INTERNAL_SERVER_ERROR);
  if (!snapshotRes.data)
    return errorResponse(`Task 不存在: ${taskId}`, HTTP_NOT_FOUND);
  if (snapshotRes.data.task.lifecycle === LIFECYCLE.DONE) {
    return errorResponse('Task 已关闭，不能开始实现', HTTP_CONFLICT);
  }
  if (!snapshotRes.data.thread.approvedPlanId) {
    return errorResponse(
      '当前 Task 没有已批准方案，不能开始实现',
      HTTP_CONFLICT,
    );
  }
  const confirmRes = confirmExecStepsIfNeeded(
    taskId,
    snapshotRes.data,
    bodyRes.data,
  );
  if (!confirmRes.success)
    return errorResponse(confirmRes.error, HTTP_CONFLICT);

  const scheduledRes = scheduleExecIfNeeded(bodyRes.data, context, {
    taskId,
    reason: 'manual',
  });
  return scheduledResponse(taskId, scheduledRes, 'Exec 调度器未启用');
}

function confirmExecStepsIfNeeded(
  taskId: string,
  snapshot: TaskPlanningSnapshot,
  payload: UnknownRecord,
): Result<void> {
  const approvedPlan = snapshot.plans.find(
    (plan) => plan.planId === snapshot.thread.approvedPlanId,
  );
  if (!approvedPlan) return failure('当前 Task 没有已批准方案，不能开始实现');

  const steps = findExecStepsArtifact(snapshot, approvedPlan);
  const stepsApproved = areExecStepsApproved(snapshot, approvedPlan);
  const wantsConfirm = readBooleanField(payload, 'confirmExecSteps') === true;

  if (!steps && wantsConfirm)
    return failure('当前 Task 还没有可确认的实施步骤');
  if (!steps || stepsApproved) return success(undefined);
  if (!wantsConfirm) return failure('实施步骤已产出，需人工确认后才能开始编码');

  const approveStepsRes = approveTaskExecSteps(taskId);
  if (!approveStepsRes.success) return failure(approveStepsRes.error);
  return success(undefined);
}

export async function handleTaskDeliveryRequest(
  req: Request,
  taskId: string,
  context: TaskApiContext,
): Promise<Response> {
  const bodyRes = await readJsonObject(req);
  if (!bodyRes.success) return errorResponse(bodyRes.error, HTTP_BAD_REQUEST);
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success)
    return errorResponse(snapshotRes.error, HTTP_INTERNAL_SERVER_ERROR);
  if (!snapshotRes.data)
    return errorResponse(`Task 不存在: ${taskId}`, HTTP_NOT_FOUND);
  if (snapshotRes.data.task.lifecycle === LIFECYCLE.DONE) {
    return errorResponse('Task 已关闭，不能开始交付', HTTP_CONFLICT);
  }
  if (
    snapshotRes.data.task.currentWorkflowKind !== WORKFLOW_KIND.EXEC ||
    snapshotRes.data.task.lifecycle !== LIFECYCLE.WAITING ||
    snapshotRes.data.task.prUrl
  ) {
    return errorResponse('当前 Task 只有在已实现后才能交付', HTTP_CONFLICT);
  }

  const scheduledRes = scheduleDeliveryIfNeeded(bodyRes.data, context, {
    taskId,
    reason: 'manual',
  });
  return scheduledResponse(taskId, scheduledRes, 'Delivery 调度器未启用');
}

export async function handleTaskManualCompleteRequest(
  req: Request,
  taskId: string,
): Promise<Response> {
  const bodyRes = await readJsonObject(req);
  if (!bodyRes.success) return errorResponse(bodyRes.error, HTTP_BAD_REQUEST);

  const stage = readTaskAgentStageField(bodyRes.data, 'stage');
  if (!stage) {
    return errorResponse(
      'stage 必须是 planning/exec/delivery',
      HTTP_BAD_REQUEST,
    );
  }

  const completeRes = completeTaskAgentStageManually({
    taskId,
    stage,
    message: readStringField(bodyRes.data, 'message'),
    prUrl: readStringField(bodyRes.data, 'prUrl'),
    prNumber: readOptionalPositiveIntField(bodyRes.data, 'prNumber'),
  });
  if (!completeRes.success)
    return errorResponse(completeRes.error, HTTP_CONFLICT);

  return jsonResponse({ taskId, snapshot: completeRes.data });
}

export async function handleTaskCompleteRequest(
  taskId: string,
  _context: TaskApiContext,
): Promise<Response> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success)
    return errorResponse(snapshotRes.error, HTTP_INTERNAL_SERVER_ERROR);
  const snapshot = snapshotRes.data;
  if (!snapshot) return errorResponse(`Task 不存在: ${taskId}`, HTTP_NOT_FOUND);

  if (
    snapshot.task.lifecycle !== LIFECYCLE.DONE &&
    snapshot.task.workspaceMode !== TASK_WORKSPACE_MODE.DEFAULT_BRANCH
  ) {
    const cleanupInputRes = readTaskCleanupInput(snapshot);
    if (!cleanupInputRes.success) {
      return errorResponse(cleanupInputRes.error, HTTP_CONFLICT);
    }

    const { cleanupIssue } = await import('../domain/cleanup-utils');
    const cleanupRes = await cleanupIssue(
      String(cleanupInputRes.data.seq),
      {
        reason: 'delivery_acceptance',
        worktreePath: cleanupInputRes.data.worktreePath,
        branchName: cleanupInputRes.data.branchName,
      },
      cleanupInputRes.data.repoOwner,
      cleanupInputRes.data.repoName,
      cleanupInputRes.data.cwd,
    );
    if (!cleanupRes.success)
      return errorResponse(cleanupRes.error, HTTP_CONFLICT);
  }

  const completeRes = completeDeliveredTask(taskId);
  if (!completeRes.success)
    return errorResponse(completeRes.error, HTTP_CONFLICT);
  return jsonResponse({ taskId, snapshot: completeRes.data });
}

function readTaskCleanupInput(snapshot: TaskPlanningSnapshot): Result<{
  seq: number;
  repoOwner: string;
  repoName: string;
  cwd: string;
  worktreePath: string;
  branchName?: string;
}> {
  if (snapshot.task.lifecycle === LIFECYCLE.DONE) {
    return failure('Task 已关闭，不能验收完成');
  }
  if (
    !snapshot.task.prUrl &&
    snapshot.task.workspaceMode !== TASK_WORKSPACE_MODE.DEFAULT_BRANCH
  ) {
    return failure('只有已交付 Task 可以验收完成');
  }
  if (!snapshot.task.repoOwner || !snapshot.task.repoName) {
    return failure('当前 Task 缺少仓库信息，不能清理本地资源');
  }
  if (!snapshot.task.cwd) {
    return failure('当前 Task 缺少仓库路径，不能同步默认分支');
  }
  if (snapshot.task.seq == null) {
    return failure('当前 Task 缺少本地序号，不能清理本地资源');
  }
  if (
    snapshot.task.workspaceMode !== TASK_WORKSPACE_MODE.DEFAULT_BRANCH &&
    !snapshot.task.worktreePath
  ) {
    return failure('当前 Task 缺少 worktree 路径，不能清理本地资源');
  }
  return success({
    seq: snapshot.task.seq,
    repoOwner: snapshot.task.repoOwner,
    repoName: snapshot.task.repoName,
    cwd: snapshot.task.cwd,
    worktreePath: snapshot.task.worktreePath || snapshot.task.cwd,
    branchName: snapshot.task.branchName,
  });
}

function readExistingTaskError(taskId: string): Response | null {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success)
    return errorResponse(snapshotRes.error, HTTP_INTERNAL_SERVER_ERROR);
  if (!snapshotRes.data)
    return errorResponse(`Task 不存在: ${taskId}`, HTTP_NOT_FOUND);
  if (snapshotRes.data.task.lifecycle === LIFECYCLE.DONE) {
    return errorResponse('Task 已关闭，不能继续推进', HTTP_CONFLICT);
  }
  return null;
}

function scheduledResponse(
  taskId: string,
  scheduledRes: Result<boolean>,
  disabledMessage: string,
): Response {
  if (!scheduledRes.success)
    return errorResponse(scheduledRes.error, HTTP_BAD_REQUEST);
  if (!scheduledRes.data)
    return errorResponse(disabledMessage, HTTP_SERVICE_UNAVAILABLE);
  return jsonResponse({ taskId, scheduled: true }, HTTP_ACCEPTED);
}

export function handleTaskDeleteRequest(taskId: string): Response {
  const result = deleteTask(taskId);
  if (!result.success) return errorResponse(result.error, HTTP_NOT_FOUND);
  return jsonResponse({ taskId, deleted: true });
}
