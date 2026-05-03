import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  approveCurrentTaskPlan,
  completeTaskAgentStageManually,
  createPlanningTask,
  listTaskPlanningSnapshots,
  readTaskAgentBinding,
  readTaskPlanningSnapshot,
  submitTaskMessage,
  TASK_AGENT_STAGE,
  type TaskAgentStage,
  type TaskPlanningSnapshot,
} from '../domain/task-planning';

export interface ScheduledTaskPlanningRun {
  taskId: string;
  cwd: string;
  reason: 'task_created' | 'user_message' | 'manual';
  agentId?: string;
  editor?: string;
  model?: string;
  personalityVersion?: string;
}

export interface ScheduledTaskImplementationRun {
  taskId: string;
  cwd: string;
  reason: 'manual';
  agentId?: string;
  editor?: string;
  model?: string;
  personalityVersion?: string;
}

export interface ScheduledTaskDeliveryRun {
  taskId: string;
  cwd: string;
  reason: 'manual';
}

export interface TaskApiContext {
  defaultCwd: string;
  schedulePlanner?: (input: ScheduledTaskPlanningRun) => void;
  scheduleImplementation?: (input: ScheduledTaskImplementationRun) => void;
  scheduleDelivery?: (input: ScheduledTaskDeliveryRun) => void;
  resolveRepoPath?: (owner: string, repo: string) => string | undefined;
}

type UnknownRecord = Record<string, unknown>;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
}

function errorResponse(error: string, status = 400): Response {
  return jsonResponse({ error }, status);
}

async function readJsonObject(req: Request): Promise<Result<UnknownRecord>> {
  try {
    const parsed = await req.json();
    return isRecord(parsed)
      ? success(parsed)
      : failure('请求体必须是 JSON 对象');
  } catch {
    return failure('请求体必须是合法 JSON');
  }
}

function readStringField(
  payload: UnknownRecord,
  key: string,
): string | undefined {
  const value = payload[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readBooleanField(
  payload: UnknownRecord,
  key: string,
): boolean | undefined {
  const value = payload[key];
  return typeof value === 'boolean' ? value : undefined;
}

function readTaskAgentStageField(
  payload: UnknownRecord,
  key: string,
): TaskAgentStage | undefined {
  const value = readStringField(payload, key);
  if (
    value === TASK_AGENT_STAGE.PLANNING ||
    value === TASK_AGENT_STAGE.IMPLEMENTATION ||
    value === TASK_AGENT_STAGE.DELIVERY
  ) {
    return value;
  }
  return undefined;
}

function readOptionalPositiveIntField(
  payload: UnknownRecord,
  key: string,
): number | undefined {
  const value = payload[key];
  if (typeof value !== 'number') return undefined;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function readPositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function deriveTitle(body: string): string {
  const firstLine = body
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  const title = firstLine || 'Untitled Task';
  return title.length > 80 ? `${title.slice(0, 80)}...` : title;
}

function resolveTaskCwd(
  payload: UnknownRecord,
  context: TaskApiContext,
  taskId?: string,
): Result<string> {
  const explicitCwd = readStringField(payload, 'cwd');
  if (explicitCwd) return success(explicitCwd);

  const owner = readStringField(payload, 'owner');
  const repo = readStringField(payload, 'repo');
  if (owner && repo && context.resolveRepoPath) {
    const repoPath = context.resolveRepoPath(owner, repo);
    if (!repoPath) return failure(`仓库 ${owner}/${repo} 未在本地工作区中注册`);
    return success(repoPath);
  }

  if (taskId) {
    const snapshotRes = readTaskPlanningSnapshot(taskId);
    if (!snapshotRes.success) return snapshotRes;
    const snapshot = snapshotRes.data;
    if (!snapshot) return failure(`Task 不存在: ${taskId}`);
    if (snapshot.task.cwd) return success(snapshot.task.cwd);

    const bindingRes = readTaskAgentBinding(
      snapshot.thread.threadId,
      readStringField(payload, 'agentId') || 'planner',
      'claude',
    );
    if (!bindingRes.success) return bindingRes;
    if (bindingRes.data?.cwd) return success(bindingRes.data.cwd);
  }

  return success(context.defaultCwd);
}

function schedulePlannerIfNeeded(
  payload: UnknownRecord,
  context: TaskApiContext,
  input: Omit<
    ScheduledTaskPlanningRun,
    'cwd' | 'agentId' | 'model' | 'personalityVersion'
  >,
): Result<boolean> {
  const autoRun = readBooleanField(payload, 'autoRun');
  if (autoRun === false || !context.schedulePlanner) return success(false);

  const cwdRes = resolveTaskCwd(payload, context, input.taskId);
  if (!cwdRes.success) return cwdRes;

  context.schedulePlanner({
    ...input,
    cwd: cwdRes.data,
    agentId: readStringField(payload, 'agentId'),
    editor: readStringField(payload, 'editor'),
    model: readStringField(payload, 'model'),
    personalityVersion: readStringField(payload, 'personalityVersion'),
  });
  return success(true);
}

function scheduleImplementationIfNeeded(
  payload: UnknownRecord,
  context: TaskApiContext,
  input: Omit<
    ScheduledTaskImplementationRun,
    'cwd' | 'agentId' | 'model' | 'personalityVersion'
  >,
): Result<boolean> {
  if (!context.scheduleImplementation) return success(false);

  const cwdRes = resolveTaskCwd(payload, context, input.taskId);
  if (!cwdRes.success) return cwdRes;

  context.scheduleImplementation({
    ...input,
    cwd: cwdRes.data,
    agentId: readStringField(payload, 'agentId'),
    editor: readStringField(payload, 'editor'),
    model: readStringField(payload, 'model'),
    personalityVersion: readStringField(payload, 'personalityVersion'),
  });
  return success(true);
}

function scheduleDeliveryIfNeeded(
  payload: UnknownRecord,
  context: TaskApiContext,
  input: ScheduledTaskDeliveryRun,
): Result<boolean> {
  if (!context.scheduleDelivery) return success(false);

  const cwdRes = resolveTaskCwd(payload, context, input.taskId);
  if (!cwdRes.success) return cwdRes;

  context.scheduleDelivery({
    ...input,
    cwd: cwdRes.data,
  });
  return success(true);
}

function getTaskRepositoryFields(
  payload: UnknownRecord,
): Pick<TaskPlanningSnapshot['task'], 'repoOwner' | 'repoName'> {
  return {
    repoOwner: readStringField(payload, 'owner'),
    repoName: readStringField(payload, 'repo'),
  };
}

export function isTaskApiPath(pathname: string): boolean {
  return pathname === '/api/tasks' || pathname.startsWith('/api/tasks/');
}

export async function handleTaskApiRequest(
  req: Request,
  url: URL,
  context: TaskApiContext,
): Promise<Response> {
  const parts = url.pathname.split('/').filter(Boolean);
  const taskId = parts[2];
  const action = parts[3];

  if (url.pathname === '/api/tasks' && req.method === 'GET') {
    const limit = readPositiveInt(url.searchParams.get('limit'), 100);
    const listRes = listTaskPlanningSnapshots(limit);
    if (!listRes.success) return errorResponse(listRes.error, 500);
    return jsonResponse(listRes.data);
  }

  if (url.pathname === '/api/tasks' && req.method === 'POST') {
    const bodyRes = await readJsonObject(req);
    if (!bodyRes.success) return errorResponse(bodyRes.error, 400);

    const taskBody = readStringField(bodyRes.data, 'body');
    if (!taskBody) return errorResponse('Task 内容不能为空', 400);

    const cwdRes = resolveTaskCwd(bodyRes.data, context);
    if (!cwdRes.success) return errorResponse(cwdRes.error, 400);
    const repository = getTaskRepositoryFields(bodyRes.data);
    const createRes = createPlanningTask({
      title: readStringField(bodyRes.data, 'title') || deriveTitle(taskBody),
      body: taskBody,
      source: readStringField(bodyRes.data, 'source') || 'web',
      repoOwner: repository.repoOwner,
      repoName: repository.repoName,
      cwd: cwdRes.data,
    });
    if (!createRes.success) return errorResponse(createRes.error, 400);

    const scheduledRes = schedulePlannerIfNeeded(bodyRes.data, context, {
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

  if (!taskId) return errorResponse('缺少 taskId', 404);

  if (!action && req.method === 'GET') {
    const snapshotRes = readTaskPlanningSnapshot(taskId);
    if (!snapshotRes.success) return errorResponse(snapshotRes.error, 500);
    if (!snapshotRes.data) return errorResponse(`Task 不存在: ${taskId}`, 404);
    return jsonResponse(snapshotRes.data);
  }

  if (action === 'messages' && req.method === 'POST') {
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

    const snapshotRes = readTaskPlanningSnapshot(taskId);
    if (!snapshotRes.success) return errorResponse(snapshotRes.error, 500);

    return jsonResponse(
      {
        taskId,
        scheduled: scheduledRes.data,
        submitted: submitRes.data,
        snapshot: snapshotRes.data,
      },
      scheduledRes.data ? 202 : 200,
    );
  }

  if (action === 'approve' && req.method === 'POST') {
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

  if (action === 'planner' && req.method === 'POST') {
    const bodyRes = await readJsonObject(req);
    if (!bodyRes.success) return errorResponse(bodyRes.error, 400);

    const snapshotRes = readTaskPlanningSnapshot(taskId);
    if (!snapshotRes.success) return errorResponse(snapshotRes.error, 500);
    if (!snapshotRes.data) return errorResponse(`Task 不存在: ${taskId}`, 404);

    const scheduledRes = schedulePlannerIfNeeded(
      { ...bodyRes.data, autoRun: true },
      context,
      {
        taskId,
        reason: 'manual',
      },
    );
    if (!scheduledRes.success) return errorResponse(scheduledRes.error, 400);
    if (!scheduledRes.data) return errorResponse('Planner 调度器未启用', 503);

    return jsonResponse({ taskId, scheduled: true }, 202);
  }

  if (action === 'implementation' && req.method === 'POST') {
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
    if (!scheduledRes.success) return errorResponse(scheduledRes.error, 400);
    if (!scheduledRes.data) {
      return errorResponse('Implementation 调度器未启用', 503);
    }

    return jsonResponse({ taskId, scheduled: true }, 202);
  }

  if (action === 'delivery' && req.method === 'POST') {
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
    if (!scheduledRes.success) return errorResponse(scheduledRes.error, 400);
    if (!scheduledRes.data) {
      return errorResponse('Delivery 调度器未启用', 503);
    }

    return jsonResponse({ taskId, scheduled: true }, 202);
  }

  if (action === 'manual-complete' && req.method === 'POST') {
    const bodyRes = await readJsonObject(req);
    if (!bodyRes.success) return errorResponse(bodyRes.error, 400);

    const stage = readTaskAgentStageField(bodyRes.data, 'stage');
    if (!stage)
      return errorResponse(
        'stage 必须是 planning/implementation/delivery',
        400,
      );

    const completeRes = completeTaskAgentStageManually({
      taskId,
      stage,
      message: readStringField(bodyRes.data, 'message'),
      prUrl: readStringField(bodyRes.data, 'prUrl'),
      prNumber: readOptionalPositiveIntField(bodyRes.data, 'prNumber'),
    });
    if (!completeRes.success) return errorResponse(completeRes.error, 409);

    return jsonResponse({
      taskId,
      snapshot: completeRes.data,
    });
  }

  return errorResponse('未找到 Task API', 404);
}
