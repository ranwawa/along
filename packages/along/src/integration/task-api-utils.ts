import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  readTaskAgentBinding,
  readTaskPlanningSnapshot,
  TASK_AGENT_STAGE,
  type TaskAgentStage,
  type TaskPlanningSnapshot,
} from '../domain/task-planning';
import type {
  ScheduledTaskDeliveryRun,
  ScheduledTaskImplementationRun,
  ScheduledTaskPlanningRun,
  TaskApiContext,
} from './task-api';

export type UnknownRecord = Record<string, unknown>;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
}

export function errorResponse(error: string, status = 400): Response {
  return jsonResponse({ error }, status);
}

export async function readJsonObject(
  req: Request,
): Promise<Result<UnknownRecord>> {
  try {
    const parsed = await req.json();
    return isRecord(parsed)
      ? success(parsed)
      : failure('请求体必须是 JSON 对象');
  } catch {
    return failure('请求体必须是合法 JSON');
  }
}

export function readStringField(
  payload: UnknownRecord,
  key: string,
): string | undefined {
  const value = payload[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function readBooleanField(
  payload: UnknownRecord,
  key: string,
): boolean | undefined {
  const value = payload[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function readTaskAgentStageField(
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

export function readOptionalPositiveIntField(
  payload: UnknownRecord,
  key: string,
): number | undefined {
  const value = payload[key];
  if (typeof value !== 'number') return undefined;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

export function readPositiveInt(
  value: string | null,
  fallback: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function deriveTitle(body: string): string {
  const normalized = body.replace(/\s+/g, ' ').trim();
  return [...(normalized || 'Untitled Task')].slice(0, 15).join('');
}

export function resolveTaskCwd(
  payload: UnknownRecord,
  context: TaskApiContext,
  taskId?: string,
): Result<string> {
  const explicitCwd = readStringField(payload, 'cwd');
  if (explicitCwd) return success(explicitCwd);

  const repoPathRes = resolveRepoPathFromPayload(payload, context);
  if (repoPathRes) return repoPathRes;

  if (taskId) {
    const savedCwdRes = resolveTaskSavedCwd(payload, taskId);
    if (!savedCwdRes.success || savedCwdRes.data) return savedCwdRes;
  }

  return success(context.defaultCwd);
}

function resolveRepoPathFromPayload(
  payload: UnknownRecord,
  context: TaskApiContext,
): Result<string> | null {
  const owner = readStringField(payload, 'owner');
  const repo = readStringField(payload, 'repo');
  if (!owner || !repo || !context.resolveRepoPath) return null;
  const repoPath = context.resolveRepoPath(owner, repo);
  if (!repoPath) return failure(`仓库 ${owner}/${repo} 未在本地工作区中注册`);
  return success(repoPath);
}

function resolveTaskSavedCwd(
  payload: UnknownRecord,
  taskId: string,
): Result<string | undefined> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${taskId}`);
  if (snapshot.task.cwd) return success(snapshot.task.cwd);
  return resolveTaskBindingCwd(payload, snapshot);
}

function resolveTaskBindingCwd(
  payload: UnknownRecord,
  snapshot: TaskPlanningSnapshot,
): Result<string | undefined> {
  const bindingRes = readTaskAgentBinding(
    snapshot.thread.threadId,
    readStringField(payload, 'agentId') || 'planner',
    'claude',
  );
  if (!bindingRes.success) return bindingRes;
  return success(bindingRes.data?.cwd);
}

export function schedulePlannerIfNeeded(
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
    ...readRunnerOptions(payload),
  });
  return success(true);
}

export function scheduleImplementationIfNeeded(
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
    ...readRunnerOptions(payload),
  });
  return success(true);
}

function readRunnerOptions(payload: UnknownRecord) {
  return {
    agentId: readStringField(payload, 'agentId'),
    editor: readStringField(payload, 'editor'),
    model: readStringField(payload, 'model'),
    personalityVersion: readStringField(payload, 'personalityVersion'),
  };
}

export function scheduleDeliveryIfNeeded(
  payload: UnknownRecord,
  context: TaskApiContext,
  input: ScheduledTaskDeliveryRun,
): Result<boolean> {
  if (!context.scheduleDelivery) return success(false);

  const cwdRes = resolveTaskCwd(payload, context, input.taskId);
  if (!cwdRes.success) return cwdRes;

  context.scheduleDelivery({ ...input, cwd: cwdRes.data });
  return success(true);
}

export function getTaskRepositoryFields(
  payload: UnknownRecord,
  context: TaskApiContext,
  cwd: string,
): Pick<TaskPlanningSnapshot['task'], 'repoOwner' | 'repoName'> {
  const repoOwner = readStringField(payload, 'owner');
  const repoName = readStringField(payload, 'repo');
  if (repoOwner && repoName) return { repoOwner, repoName };

  return context.resolveRepositoryForPath?.(cwd) || {};
}
