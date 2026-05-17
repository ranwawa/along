import {
  completeDeliveredTask,
  deleteTask,
  LIFECYCLE,
  readTaskPlanningSnapshot,
  TASK_WORKSPACE_MODE,
  type TaskPlanningSnapshot,
} from '../../app/planning';
import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import {
  HTTP_CONFLICT,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
} from './http-status';
import type { TaskApiContext } from './task-api';
import { errorResponse, jsonResponse } from './task-api-utils';

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

    const { cleanupIssue } = await import('../../app/task/cleanup-utils');
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

export function handleTaskDeleteRequest(taskId: string): Response {
  const result = deleteTask(taskId);
  if (!result.success) return errorResponse(result.error, HTTP_NOT_FOUND);
  return jsonResponse({ taskId, deleted: true });
}
