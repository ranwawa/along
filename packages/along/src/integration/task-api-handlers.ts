import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import type { TaskAttachmentUploadInput } from '../domain/task-attachments';
import {
  createPlanningTask,
  listTaskPlanningSnapshots,
  readTaskPlanningSnapshot,
  submitTaskMessage,
  type TaskPlanningSnapshot,
} from '../domain/task-planning';
import {
  HTTP_ACCEPTED,
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_CREATED,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
} from './http-status';
import type { TaskApiContext } from './task-api';
import { readTaskAttachmentResponse } from './task-api-attachments';
import {
  deriveTitle,
  getTaskRepositoryFields,
  resolveTaskCwd,
  schedulePlannerIfNeeded,
} from './task-api-scheduler';
import { scheduleTitleSummary } from './task-api-title-summary';
import {
  errorResponse,
  jsonResponse,
  readPositiveInt,
  readStringField,
  readTaskExecutionModeField,
  readTaskRequestPayload,
  readTaskRuntimeExecutionModeField,
  readTaskWorkspaceModeField,
  type UnknownRecord,
} from './task-api-utils';

const DEFAULT_TASK_LIST_LIMIT = 100;

export function handleTaskListRequest(url: URL): Response {
  const limit = readPositiveInt(
    url.searchParams.get('limit'),
    DEFAULT_TASK_LIST_LIMIT,
  );
  const repoOwner = url.searchParams.get('owner')?.trim() || undefined;
  const repoName = url.searchParams.get('repo')?.trim() || undefined;
  const listRes = listTaskPlanningSnapshots(limit, { repoOwner, repoName });
  return listRes.success
    ? jsonResponse(listRes.data)
    : errorResponse(listRes.error, HTTP_INTERNAL_SERVER_ERROR);
}

export async function handleTaskCreateRequest(
  req: Request,
  context: TaskApiContext,
): Promise<Response> {
  const bodyRes = await readTaskRequestPayload(req);
  if (!bodyRes.success) return errorResponse(bodyRes.error, HTTP_BAD_REQUEST);
  const taskBody =
    readStringField(bodyRes.data.payload, 'body') ||
    (bodyRes.data.attachments.length > 0 ? '（用户上传了图片）' : undefined);
  if (!taskBody) return errorResponse('Task 内容不能为空', HTTP_BAD_REQUEST);

  const createRes = createTaskFromPayload(
    bodyRes.data.payload,
    context,
    taskBody,
    bodyRes.data.attachments,
  );
  if (!createRes.success)
    return errorResponse(createRes.error, HTTP_BAD_REQUEST);
  scheduleTitleSummary(context, {
    taskId: createRes.data.task.taskId,
    body: taskBody,
    ...(bodyRes.data.attachments.length
      ? { attachmentCount: bodyRes.data.attachments.length }
      : {}),
  });
  return scheduleAndRespond(bodyRes.data.payload, context, createRes.data);
}

function scheduleAndRespond(
  payload: UnknownRecord,
  context: TaskApiContext,
  snapshot: TaskPlanningSnapshot,
): Response {
  const scheduledRes = schedulePlannerIfNeeded(payload, context, {
    taskId: snapshot.task.taskId,
    reason: 'task_created',
  });
  if (!scheduledRes.success)
    return errorResponse(scheduledRes.error, HTTP_BAD_REQUEST);
  return jsonResponse(
    { taskId: snapshot.task.taskId, scheduled: scheduledRes.data, snapshot },
    scheduledRes.data ? HTTP_ACCEPTED : HTTP_CREATED,
  );
}

export function createTaskFromPayload(
  payload: UnknownRecord,
  context: TaskApiContext,
  taskBody: string,
  attachments: TaskAttachmentUploadInput[] = [],
): Result<TaskPlanningSnapshot> {
  const cwdRes = resolveTaskCwd(payload, context);
  if (!cwdRes.success) return cwdRes;
  const executionModeRes = readTaskExecutionModeField(payload, 'executionMode');
  if (!executionModeRes.success) return executionModeRes;
  const runtimeExecutionModeRes = readTaskRuntimeExecutionModeField(
    payload,
    'runtimeExecutionMode',
  );
  if (!runtimeExecutionModeRes.success) return runtimeExecutionModeRes;
  const workspaceModeRes = readTaskWorkspaceModeField(payload, 'workspaceMode');
  if (!workspaceModeRes.success) return workspaceModeRes;
  const repository = getTaskRepositoryFields(payload, context, cwdRes.data);
  return createPlanningTask({
    title: deriveTitle(taskBody),
    body: taskBody,
    source: readStringField(payload, 'source') || 'web',
    repoOwner: repository.repoOwner,
    repoName: repository.repoName,
    cwd: cwdRes.data,
    executionMode: executionModeRes.data,
    runtimeExecutionMode: runtimeExecutionModeRes.data,
    workspaceMode: workspaceModeRes.data,
    ...(attachments.length ? { attachments } : {}),
  });
}

export function handleTaskGetRequest(taskId: string): Response {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success)
    return errorResponse(snapshotRes.error, HTTP_INTERNAL_SERVER_ERROR);
  if (!snapshotRes.data)
    return errorResponse(`Task 不存在: ${taskId}`, HTTP_NOT_FOUND);
  return jsonResponse(snapshotRes.data);
}

export async function handleTaskMessageRequest(
  req: Request,
  taskId: string,
  context: TaskApiContext,
): Promise<Response> {
  const bodyRes = await readTaskRequestPayload(req);
  if (!bodyRes.success) return errorResponse(bodyRes.error, HTTP_BAD_REQUEST);

  const message =
    readStringField(bodyRes.data.payload, 'body') ||
    (bodyRes.data.attachments.length > 0 ? '（用户上传了图片）' : undefined);
  if (!message) return errorResponse('用户消息不能为空', HTTP_BAD_REQUEST);
  const runtimeExecutionModeRes = readTaskRuntimeExecutionModeField(
    bodyRes.data.payload,
    'runtimeExecutionMode',
  );
  if (!runtimeExecutionModeRes.success) {
    return errorResponse(runtimeExecutionModeRes.error, HTTP_BAD_REQUEST);
  }

  const submitRes = submitTaskMessage({
    taskId,
    body: message,
    runtimeExecutionMode: runtimeExecutionModeRes.data,
    ...(bodyRes.data.attachments.length
      ? { attachments: bodyRes.data.attachments }
      : {}),
  });
  if (!submitRes.success) return errorResponse(submitRes.error, HTTP_CONFLICT);

  const scheduledRes = schedulePlannerIfNeeded(bodyRes.data.payload, context, {
    taskId,
    reason: 'user_message',
  });
  if (!scheduledRes.success)
    return errorResponse(scheduledRes.error, HTTP_BAD_REQUEST);

  return readSnapshotForMessage(taskId, scheduledRes.data, submitRes.data);
}

export function handleTaskAttachmentRequest(
  taskId: string,
  attachmentId: string,
): Response | Promise<Response> {
  return readTaskAttachmentResponse(taskId, attachmentId);
}

export function readSnapshotForMessage(
  taskId: string,
  scheduled: boolean,
  submitted: unknown,
): Response {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success)
    return errorResponse(snapshotRes.error, HTTP_INTERNAL_SERVER_ERROR);
  return jsonResponse(
    {
      taskId,
      scheduled,
      submitted,
      snapshot: snapshotRes.data,
    },
    scheduled ? HTTP_ACCEPTED : HTTP_OK,
  );
}

export async function readOptionalJsonObject(
  req: Request,
): Promise<Result<UnknownRecord>> {
  try {
    const raw = await req.text();
    if (!raw.trim()) return success({});
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
      ? success(parsed as UnknownRecord)
      : failure('请求体必须是 JSON 对象');
  } catch {
    return failure('请求体必须是合法 JSON');
  }
}
