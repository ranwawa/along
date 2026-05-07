// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: legacy API handler file keeps related route handlers together.
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import type { TaskAttachmentUploadInput } from '../domain/task-attachments';
import {
  areImplementationStepsApproved,
  findImplementationStepsArtifact,
} from '../domain/task-implementation-steps';
import {
  approveCurrentTaskPlan,
  approveTaskImplementationSteps,
  closeTask,
  completeDeliveredTask,
  completeTaskAgentStageManually,
  createPlanningTask,
  listTaskPlanningSnapshots,
  readTaskPlanningSnapshot,
  requestTaskPlan,
  submitTaskMessage,
  TASK_LIFECYCLE,
  type TaskPlanningSnapshot,
  WORKFLOW_KIND,
} from '../domain/task-planning';
import type { TaskApiContext } from './task-api';
import { readTaskAttachmentResponse } from './task-api-attachments';
import { scheduleTitleSummary } from './task-api-title-summary';
import {
  deriveTitle,
  errorResponse,
  getTaskRepositoryFields,
  jsonResponse,
  readBooleanField,
  readJsonObject,
  readOptionalPositiveIntField,
  readPositiveInt,
  readStringField,
  readTaskAgentStageField,
  readTaskExecutionModeField,
  readTaskRequestPayload,
  resolveTaskCwd,
  scheduleDeliveryIfNeeded,
  scheduleImplementationIfNeeded,
  schedulePlannerIfNeeded,
  type UnknownRecord,
} from './task-api-utils';

export function handleTaskListRequest(url: URL): Response {
  const limit = readPositiveInt(url.searchParams.get('limit'), 100);
  const repoOwner = url.searchParams.get('owner')?.trim() || undefined;
  const repoName = url.searchParams.get('repo')?.trim() || undefined;
  const listRes = listTaskPlanningSnapshots(limit, { repoOwner, repoName });
  return listRes.success
    ? jsonResponse(listRes.data)
    : errorResponse(listRes.error, 500);
}

export async function handleTaskCreateRequest(
  req: Request,
  context: TaskApiContext,
): Promise<Response> {
  const bodyRes = await readTaskRequestPayload(req);
  if (!bodyRes.success) return errorResponse(bodyRes.error, 400);

  const taskBody =
    readStringField(bodyRes.data.payload, 'body') ||
    (bodyRes.data.attachments.length > 0 ? '（用户上传了图片）' : undefined);
  if (!taskBody) return errorResponse('Task 内容不能为空', 400);

  const createRes = createTaskFromPayload(
    bodyRes.data.payload,
    context,
    taskBody,
    bodyRes.data.attachments,
  );
  if (!createRes.success) return errorResponse(createRes.error, 400);

  scheduleTitleSummary(context, {
    taskId: createRes.data.task.taskId,
    body: taskBody,
    ...(bodyRes.data.attachments.length
      ? { attachmentCount: bodyRes.data.attachments.length }
      : {}),
  });

  const scheduledRes = schedulePlannerIfNeeded(bodyRes.data.payload, context, {
    taskId: createRes.data.task.taskId,
    reason: 'task_created',
  });
  if (!scheduledRes.success) return errorResponse(scheduledRes.error, 400);

  return jsonResponse(
    {
      taskId: createRes.data.task.taskId,
      scheduled: scheduledRes.data,
      snapshot: createRes.data,
    },
    scheduledRes.data ? 202 : 201,
  );
}

function createTaskFromPayload(
  payload: UnknownRecord,
  context: TaskApiContext,
  taskBody: string,
  attachments: TaskAttachmentUploadInput[] = [],
): Result<TaskPlanningSnapshot> {
  const cwdRes = resolveTaskCwd(payload, context);
  if (!cwdRes.success) return cwdRes;
  const executionModeRes = readTaskExecutionModeField(payload, 'executionMode');
  if (!executionModeRes.success) return executionModeRes;
  const repository = getTaskRepositoryFields(payload, context, cwdRes.data);
  return createPlanningTask({
    title: deriveTitle(taskBody),
    body: taskBody,
    source: readStringField(payload, 'source') || 'web',
    repoOwner: repository.repoOwner,
    repoName: repository.repoName,
    cwd: cwdRes.data,
    executionMode: executionModeRes.data,
    ...(attachments.length ? { attachments } : {}),
  });
}

export function handleTaskGetRequest(taskId: string): Response {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return errorResponse(snapshotRes.error, 500);
  if (!snapshotRes.data) return errorResponse(`Task 不存在: ${taskId}`, 404);
  return jsonResponse(snapshotRes.data);
}

export async function handleTaskMessageRequest(
  req: Request,
  taskId: string,
  context: TaskApiContext,
): Promise<Response> {
  const bodyRes = await readTaskRequestPayload(req);
  if (!bodyRes.success) return errorResponse(bodyRes.error, 400);

  const message =
    readStringField(bodyRes.data.payload, 'body') ||
    (bodyRes.data.attachments.length > 0 ? '（用户上传了图片）' : undefined);
  if (!message) return errorResponse('用户消息不能为空', 400);

  const submitRes = submitTaskMessage({
    taskId,
    body: message,
    ...(bodyRes.data.attachments.length
      ? { attachments: bodyRes.data.attachments }
      : {}),
  });
  if (!submitRes.success) return errorResponse(submitRes.error, 409);

  const scheduledRes = schedulePlannerIfNeeded(bodyRes.data.payload, context, {
    taskId,
    reason: 'user_message',
  });
  if (!scheduledRes.success) return errorResponse(scheduledRes.error, 400);

  return readSnapshotForMessage(taskId, scheduledRes.data, submitRes.data);
}

export function handleTaskAttachmentRequest(
  taskId: string,
  attachmentId: string,
): Response | Promise<Response> {
  return readTaskAttachmentResponse(taskId, attachmentId);
}

function readSnapshotForMessage(
  taskId: string,
  scheduled: boolean,
  submitted: unknown,
): Response {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return errorResponse(snapshotRes.error, 500);
  return jsonResponse(
    {
      taskId,
      scheduled,
      submitted,
      snapshot: snapshotRes.data,
    },
    scheduled ? 202 : 200,
  );
}

export function handleTaskApproveRequest(taskId: string): Response {
  const approveRes = approveCurrentTaskPlan(taskId);
  if (!approveRes.success) return errorResponse(approveRes.error, 409);

  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return errorResponse(snapshotRes.error, 500);

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
  if (!bodyRes.success) return errorResponse(bodyRes.error, 400);

  const existing = readTaskPlanningSnapshot(taskId);
  if (!existing.success) return errorResponse(existing.error, 500);
  if (!existing.data) return errorResponse(`Task 不存在: ${taskId}`, 404);

  const closeRes = closeTask(taskId, readStringField(bodyRes.data, 'reason'));
  if (!closeRes.success) return errorResponse(closeRes.error, 409);
  return jsonResponse({ taskId, snapshot: closeRes.data });
}

export async function handleTaskPlannerRequest(
  req: Request,
  taskId: string,
  context: TaskApiContext,
): Promise<Response> {
  const bodyRes = await readJsonObject(req);
  if (!bodyRes.success) return errorResponse(bodyRes.error, 400);
  const snapshotError = readExistingTaskError(taskId);
  if (snapshotError) return snapshotError;
  const requestPlanRes = requestTaskPlan(taskId);
  if (!requestPlanRes.success) return errorResponse(requestPlanRes.error, 409);

  const scheduledRes = schedulePlannerIfNeeded(
    { ...bodyRes.data, autoRun: true },
    context,
    { taskId, reason: 'manual' },
  );
  if (!scheduledRes.success) return errorResponse(scheduledRes.error, 400);
  if (!scheduledRes.data) return errorResponse('Planner 调度器未启用', 503);

  return jsonResponse({ taskId, scheduled: true }, 202);
}

export async function handleTaskImplementationRequest(
  req: Request,
  taskId: string,
  context: TaskApiContext,
): Promise<Response> {
  const bodyRes = await readJsonObject(req);
  if (!bodyRes.success) return errorResponse(bodyRes.error, 400);
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return errorResponse(snapshotRes.error, 500);
  if (!snapshotRes.data) return errorResponse(`Task 不存在: ${taskId}`, 404);
  if (snapshotRes.data.task.lifecycle === TASK_LIFECYCLE.CANCELLED) {
    return errorResponse('Task 已关闭，不能开始实现', 409);
  }
  if (!snapshotRes.data.thread.approvedPlanId) {
    return errorResponse('当前 Task 没有已批准方案，不能开始实现', 409);
  }
  const confirmRes = confirmImplementationStepsIfNeeded(
    taskId,
    snapshotRes.data,
    bodyRes.data,
  );
  if (!confirmRes.success) return errorResponse(confirmRes.error, 409);

  const scheduledRes = scheduleImplementationIfNeeded(bodyRes.data, context, {
    taskId,
    reason: 'manual',
  });
  return scheduledResponse(taskId, scheduledRes, 'Implementation 调度器未启用');
}

function confirmImplementationStepsIfNeeded(
  taskId: string,
  snapshot: TaskPlanningSnapshot,
  payload: UnknownRecord,
): Result<void> {
  const approvedPlan = snapshot.plans.find(
    (plan) => plan.planId === snapshot.thread.approvedPlanId,
  );
  if (!approvedPlan) return failure('当前 Task 没有已批准方案，不能开始实现');

  const steps = findImplementationStepsArtifact(snapshot, approvedPlan);
  const stepsApproved = areImplementationStepsApproved(snapshot, approvedPlan);
  const wantsConfirm =
    readBooleanField(payload, 'confirmImplementationSteps') === true;

  if (!steps && wantsConfirm)
    return failure('当前 Task 还没有可确认的实施步骤');
  if (!steps || stepsApproved) return success(undefined);
  if (!wantsConfirm) return failure('实施步骤已产出，需人工确认后才能开始编码');

  const approveStepsRes = approveTaskImplementationSteps(taskId);
  if (!approveStepsRes.success) return failure(approveStepsRes.error);
  return success(undefined);
}

export async function handleTaskDeliveryRequest(
  req: Request,
  taskId: string,
  context: TaskApiContext,
): Promise<Response> {
  const bodyRes = await readJsonObject(req);
  if (!bodyRes.success) return errorResponse(bodyRes.error, 400);
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return errorResponse(snapshotRes.error, 500);
  if (!snapshotRes.data) return errorResponse(`Task 不存在: ${taskId}`, 404);
  if (snapshotRes.data.task.lifecycle === TASK_LIFECYCLE.CANCELLED) {
    return errorResponse('Task 已关闭，不能开始交付', 409);
  }
  if (
    snapshotRes.data.task.currentWorkflowKind !==
      WORKFLOW_KIND.IMPLEMENTATION ||
    snapshotRes.data.task.lifecycle !== TASK_LIFECYCLE.READY ||
    snapshotRes.data.task.prUrl
  ) {
    return errorResponse('当前 Task 只有在已实现后才能交付', 409);
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
  if (!bodyRes.success) return errorResponse(bodyRes.error, 400);

  const stage = readTaskAgentStageField(bodyRes.data, 'stage');
  if (!stage) {
    return errorResponse('stage 必须是 planning/implementation/delivery', 400);
  }

  const completeRes = completeTaskAgentStageManually({
    taskId,
    stage,
    message: readStringField(bodyRes.data, 'message'),
    prUrl: readStringField(bodyRes.data, 'prUrl'),
    prNumber: readOptionalPositiveIntField(bodyRes.data, 'prNumber'),
  });
  if (!completeRes.success) return errorResponse(completeRes.error, 409);

  return jsonResponse({ taskId, snapshot: completeRes.data });
}

export function handleTaskCompleteRequest(taskId: string): Response {
  const completeRes = completeDeliveredTask(taskId);
  if (!completeRes.success) return errorResponse(completeRes.error, 409);
  return jsonResponse({ taskId, snapshot: completeRes.data });
}

function readExistingTaskError(taskId: string): Response | null {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return errorResponse(snapshotRes.error, 500);
  if (!snapshotRes.data) return errorResponse(`Task 不存在: ${taskId}`, 404);
  if (snapshotRes.data.task.lifecycle === TASK_LIFECYCLE.CANCELLED) {
    return errorResponse('Task 已关闭，不能继续推进', 409);
  }
  return null;
}

function scheduledResponse(
  taskId: string,
  scheduledRes: Result<boolean>,
  disabledMessage: string,
): Response {
  if (!scheduledRes.success) return errorResponse(scheduledRes.error, 400);
  if (!scheduledRes.data) return errorResponse(disabledMessage, 503);
  return jsonResponse({ taskId, scheduled: true }, 202);
}
