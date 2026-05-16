import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  readTaskAgentBinding,
  readTaskPlanningSnapshot,
  TASK_RUNTIME_EXECUTION_MODE,
  type TaskPlanningSnapshot,
  type TaskRuntimeExecutionMode,
} from '../domain/task-planning';
import type {
  ScheduledTaskDeliveryRun,
  ScheduledTaskExecRun,
  ScheduledTaskPlanningRun,
  TaskApiContext,
} from './task-api';
import {
  readBooleanField,
  readStringField,
  type UnknownRecord,
} from './task-api-utils';

const TASK_TITLE_MAX_CHARS = 15;

export function deriveTitle(body: string): string {
  const normalized = body.replace(/\s+/g, ' ').trim();
  return [...(normalized || 'Untitled Task')]
    .slice(0, TASK_TITLE_MAX_CHARS)
    .join('');
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
    if (!savedCwdRes.success) return savedCwdRes;
    if (savedCwdRes.data) return success(savedCwdRes.data);
  }

  return success(context.defaultCwd);
}

export function resolveRepoPathFromPayload(
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

export function resolveTaskSavedCwd(
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

export function resolveTaskBindingCwd(
  payload: UnknownRecord,
  snapshot: TaskPlanningSnapshot,
): Result<string | undefined> {
  const bindingRes = readTaskAgentBinding(
    snapshot.thread.threadId,
    readStringField(payload, 'agentId') || 'planner',
    'codex',
  );
  if (!bindingRes.success) return bindingRes;
  return success(bindingRes.data?.cwd);
}

export function schedulePlannerIfNeeded(
  payload: UnknownRecord,
  context: TaskApiContext,
  input: Omit<
    ScheduledTaskPlanningRun,
    'cwd' | 'agentId' | 'modelId' | 'personalityVersion'
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

export function scheduleExecIfNeeded(
  payload: UnknownRecord,
  context: TaskApiContext,
  input: Omit<
    ScheduledTaskExecRun,
    'cwd' | 'agentId' | 'modelId' | 'personalityVersion'
  >,
): Result<boolean> {
  if (!context.scheduleExec) return success(false);

  const cwdRes = resolveTaskCwd(payload, context, input.taskId);
  if (!cwdRes.success) return cwdRes;

  context.scheduleExec({
    ...input,
    cwd: cwdRes.data,
    ...readRunnerOptions(payload),
  });
  return success(true);
}

export function scheduleDeliveryIfNeeded(
  payload: UnknownRecord,
  context: TaskApiContext,
  input: Omit<ScheduledTaskDeliveryRun, 'cwd'>,
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

export function readRunnerOptions(payload: UnknownRecord) {
  const runtimeExecutionMode = readStringField(payload, 'runtimeExecutionMode');
  return {
    agentId: readStringField(payload, 'agentId'),
    modelId: readStringField(payload, 'modelId'),
    personalityVersion: readStringField(payload, 'personalityVersion'),
    runtimeExecutionMode: isTaskRuntimeExecutionMode(runtimeExecutionMode)
      ? runtimeExecutionMode
      : undefined,
  };
}

export function isTaskRuntimeExecutionMode(
  value: string | undefined,
): value is TaskRuntimeExecutionMode {
  return (
    value === TASK_RUNTIME_EXECUTION_MODE.AUTO ||
    value === TASK_RUNTIME_EXECUTION_MODE.CHAT ||
    value === TASK_RUNTIME_EXECUTION_MODE.PLAN ||
    value === TASK_RUNTIME_EXECUTION_MODE.EXEC
  );
}
