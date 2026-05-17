import fs from 'node:fs';
import path from 'node:path';
import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import { TASK_WORKSPACE_MODE, type TaskPlanningSnapshot } from '../planning';
import type { TaskWorktreeCommandRunner } from './types';

export interface TaskWorktreeContext {
  runner: TaskWorktreeCommandRunner;
  snapshot: TaskPlanningSnapshot;
  repoPath: string;
  worktreePath: string;
  branchName: string;
  defaultBranch: string;
  workspaceMode: 'worktree' | 'default_branch';
}

async function runGit(
  runner: TaskWorktreeCommandRunner,
  cwd: string,
  args: string[],
): Promise<Result<string>> {
  return runner('git', args, { cwd });
}

export async function isGitWorktree(
  runner: TaskWorktreeCommandRunner,
  worktreePath: string,
): Promise<boolean> {
  if (!fs.existsSync(worktreePath)) return false;
  const result = await runGit(runner, worktreePath, [
    'rev-parse',
    '--is-inside-work-tree',
  ]);
  return result.success && result.data.trim() === 'true';
}

export async function syncDefaultBranch(context: TaskWorktreeContext) {
  if (context.workspaceMode === TASK_WORKSPACE_MODE.WORKTREE) {
    fs.mkdirSync(path.dirname(context.worktreePath), { recursive: true });
  }
  const fetchRes = await runGit(context.runner, context.repoPath, [
    'fetch',
    'origin',
    context.defaultBranch,
  ]);
  if (!fetchRes.success) {
    return failure(`同步远端默认分支失败: ${fetchRes.error}`);
  }
  if (context.workspaceMode === TASK_WORKSPACE_MODE.WORKTREE) {
    await runGit(context.runner, context.repoPath, ['worktree', 'prune']);
  }
  return success(null);
}

async function checkDefaultBranchClean(context: TaskWorktreeContext) {
  const statusRes = await runGit(context.runner, context.repoPath, [
    'status',
    '--porcelain',
  ]);
  if (!statusRes.success) {
    return failure(`读取默认分支工作区状态失败: ${statusRes.error}`);
  }
  const changedFiles = statusRes.data
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
  if (changedFiles.length > 0) {
    return failure(
      `默认分支工作区存在未提交变更，不能直接执行 Task: ${changedFiles.join(', ')}`,
    );
  }
  return success(null);
}

async function switchAndFastForward(context: TaskWorktreeContext) {
  const switchRes = await runGit(context.runner, context.repoPath, [
    'switch',
    context.defaultBranch,
  ]);
  if (!switchRes.success) {
    return failure(`切换默认分支失败: ${switchRes.error}`);
  }
  const ffRes = await runGit(context.runner, context.repoPath, [
    'merge',
    '--ff-only',
    `origin/${context.defaultBranch}`,
  ]);
  return ffRes.success
    ? success(null)
    : failure(`同步默认分支失败: ${ffRes.error}`);
}

export async function ensureDefaultBranchReady(context: TaskWorktreeContext) {
  const cleanRes = await checkDefaultBranchClean(context);
  if (!cleanRes.success) return cleanRes;
  return switchAndFastForward(context);
}

export async function createTaskWorktree(context: TaskWorktreeContext) {
  const addArgs = context.snapshot.task.branchName
    ? ['worktree', 'add', context.worktreePath, context.branchName]
    : [
        'worktree',
        'add',
        '-B',
        context.branchName,
        context.worktreePath,
        `origin/${context.defaultBranch}`,
      ];
  const addRes = await runGit(context.runner, context.repoPath, addArgs);
  return addRes.success
    ? success(null)
    : failure(`创建 Task worktree 失败: ${addRes.error}`);
}
