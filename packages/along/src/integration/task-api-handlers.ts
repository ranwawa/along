import type { Result } from '../core/result';
import {
  approveCurrentTaskPlan,
  completeDeliveredTask,
  completeTaskAgentStageManually,
  createPlanningTask,
  listTaskPlanningSnapshots,
  readTaskPlanningSnapshot,
  submitTaskMessage,
  type TaskPlanningSnapshot,
} from '../domain/task-planning';
import type { TaskApiContext } from './task-api';
import {
  deriveTitle,
  errorResponse,
  getTaskRepositoryFields,
  jsonResponse,
  readJsonObject,
  readOptionalPositiveIntField,
  readPositiveInt,
  readStringField,
  readTaskAgentStageField,
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
  const bodyRes = await readJsonObject(req);
  if (!bodyRes.success) return errorResponse(bodyRes.error, 400);

  const taskBody = readStringField(bodyRes.data, 'body');
  if (!taskBody) return errorResponse('Task 内容不能为空', 400);

  const createRes = createTaskFromPayload(bodyRes.data, context, taskBody);
  if (!createRes.success) return errorResponse(createRes.error, 400);

  const scheduledRes = schedulePlannerIfNeeded(bodyRes.data, context, {
    taskId: createRes.data.task.taskId,
    reason: 'task_created',
  });
  if (!scheduledRes.success) return errorResponse(scheduledRes.error, 400);

  return jsonResponse(
    buildScheduledPayload(createRes.data.task.taskId, scheduledRes.data, {
      snapshot: createRes.data,
    }),
    scheduledRes.data ? 202 : 201,
  );
}

function createTaskFromPayload(
  payload: UnknownRecord,
  context: TaskApiContext,
  taskBody: string,
): Result<TaskPlanningSnapshot> {
  const cwdRes = resolveTaskCwd(payload, context);
  if (!cwdRes.success) return cwdRes;
  const repository = getTaskRepositoryFields(payload, context, cwdRes.data);
  return createPlanningTask({
    title: readStringField(payload, 'title') || deriveTitle(taskBody),
    body: taskBody,
    source: readStringField(payload, 'source') || 'web',
    repoOwner: repository.repoOwner,
    repoName: repository.repoName,
    cwd: cwdRes.data,
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
  const bodyRes = await readJsonObject(req);
  if (!bodyRes.success) return errorResponse(bodyRes.error, 400);

  const message = readStringField(bodyRes.data, 'body');
  if (!message) return errorResponse('用户消息不能为空', 400);

  const submitRes = submitTaskMessage({ taskId, body: message });
  if (!submitRes.success) return errorResponse(submitRes.error, 409);

  const scheduledRes = schedulePlannerIfNeeded(bodyRes.data, context, {
    taskId,
    reason: 'user_message',
  });
  if (!scheduledRes.success) return errorResponse(scheduledRes.error, 400);

  return readSnapshotForMessage(taskId, scheduledRes.data, submitRes.data);
}

function readSnapshotForMessage(
  taskId: string,
  scheduled: boolean,
  submitted: unknown,
): Response {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return errorResponse(snapshotRes.error, 500);
  return jsonResponse(
    buildScheduledPayload(taskId, scheduled, {
      submitted,
      snapshot: snapshotRes.data,
    }),
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

export async function handleTaskPlannerRequest(
  req: Request,
  taskId: string,
  context: TaskApiContext,
): Promise<Response> {
  const bodyRes = await readJsonObject(req);
  if (!bodyRes.success) return errorResponse(bodyRes.error, 400);
  const snapshotError = readExistingTaskError(taskId);
  if (snapshotError) return snapshotError;

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
  if (!snapshotRes.data.thread.approvedPlanId) {
    return errorResponse('当前 Task 没有已批准方案，不能开始实现', 409);
  }

  const scheduledRes = scheduleImplementationIfNeeded(bodyRes.data, context, {
    taskId,
    reason: 'manual',
  });
  return scheduledResponse(taskId, scheduledRes, 'Implementation 调度器未启用');
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
  if (snapshotRes.data.task.status !== 'implemented') {
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

function buildScheduledPayload(
  taskId: string,
  scheduled: boolean,
  extra: UnknownRecord,
) {
  return { taskId, scheduled, ...extra };
}
