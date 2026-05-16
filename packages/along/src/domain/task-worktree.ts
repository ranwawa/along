import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../core/config';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  TASK_WORKSPACE_MODE,
  type TaskPlanningSnapshot,
  updateTaskDelivery,
  updateTaskRepository,
} from './task-planning';
import { generateTaskBranchName } from './task-worktree-branch';
import {
  createTaskWorktree,
  ensureDefaultBranchReady,
  isGitWorktree,
  syncDefaultBranch,
  type TaskWorktreeContext,
} from './task-worktree-ops';

export type {
  TaskWorktreeCommandOptions,
  TaskWorktreeCommandRunner,
} from './task-worktree-types';

import type {
  TaskWorktreeCommandOptions,
  TaskWorktreeCommandRunner,
} from './task-worktree-types';
import { getDefaultBranch } from './worktree-init';

export interface PrepareTaskWorktreeInput {
  snapshot: TaskPlanningSnapshot;
  repoPath: string;
  commandRunner?: TaskWorktreeCommandRunner;
  readDefaultBranch?: (repoPath: string) => Promise<Result<string>>;
}

export interface PrepareTaskWorktreeOutput {
  worktreePath: string;
  branchName: string;
  defaultBranch: string;
  workspaceMode: 'worktree' | 'default_branch';
}

export interface TaskRepositoryInfo {
  repoOwner: string;
  repoName: string;
  inferred: boolean;
}

function getErrorOutput(result: ReturnType<typeof spawnSync>): string {
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  return stderr || stdout || `命令退出码 ${result.status}`;
}

export async function defaultTaskWorktreeCommandRunner(
  command: string,
  args: string[],
  options: TaskWorktreeCommandOptions,
): Promise<Result<string>> {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf-8',
  });
  if (result.error) return failure(result.error.message);
  if (result.status !== 0) return failure(getErrorOutput(result));
  return success(
    typeof result.stdout === 'string' ? result.stdout.trimEnd() : '',
  );
}

async function runGit(
  runner: TaskWorktreeCommandRunner,
  cwd: string,
  args: string[],
): Promise<Result<string>> {
  return runner('git', args, { cwd });
}

function parseGitRemoteUrl(
  remote: string,
): { repoOwner: string; repoName: string } | null {
  const trimmed = remote.trim();
  const match = trimmed.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) return null;
  return { repoOwner: match[1], repoName: match[2].trim() };
}

export async function ensureTaskRepository(
  snapshot: TaskPlanningSnapshot,
  repoPath: string,
  runner: TaskWorktreeCommandRunner,
): Promise<Result<TaskRepositoryInfo>> {
  if (snapshot.task.repoOwner && snapshot.task.repoName) {
    return success({
      repoOwner: snapshot.task.repoOwner,
      repoName: snapshot.task.repoName,
      inferred: false,
    });
  }

  const remoteRes = await runGit(runner, repoPath, [
    'remote',
    'get-url',
    'origin',
  ]);
  if (!remoteRes.success) {
    return failure(
      `当前 Task 缺少仓库 owner/repo，且无法读取 git origin: ${remoteRes.error}`,
    );
  }

  const parsed = parseGitRemoteUrl(remoteRes.data);
  if (!parsed) {
    return failure(
      `当前 Task 缺少仓库 owner/repo，且无法解析 git origin: ${remoteRes.data.trim()}`,
    );
  }

  const updateRes = updateTaskRepository({
    taskId: snapshot.task.taskId,
    repoOwner: parsed.repoOwner,
    repoName: parsed.repoName,
    cwd: repoPath,
  });
  if (!updateRes.success) return updateRes;

  return success({ ...parsed, inferred: true });
}

function getTaskDataDir(
  snapshot: TaskPlanningSnapshot,
  repoOwner: string,
  repoName: string,
) {
  return snapshot.task.seq != null
    ? config.getTaskDirBySeq(repoOwner, repoName, snapshot.task.seq)
    : config.getTaskDir(repoOwner, repoName, snapshot.task.taskId);
}

async function resolveBranchName(
  input: PrepareTaskWorktreeInput,
  runner: TaskWorktreeCommandRunner,
) {
  return (
    input.snapshot.task.branchName ||
    generateTaskBranchName(
      runner,
      input.repoPath,
      input.snapshot.task.taskId,
      input.snapshot.task.title,
      input.snapshot.task.seq,
      input.snapshot.task.type,
    )
  );
}

async function resolveTaskWorktreeContext(
  input: PrepareTaskWorktreeInput,
): Promise<Result<TaskWorktreeContext>> {
  const runner = input.commandRunner || defaultTaskWorktreeCommandRunner;
  const repositoryRes = await ensureTaskRepository(
    input.snapshot,
    input.repoPath,
    runner,
  );
  if (!repositoryRes.success) {
    return failure(`${repositoryRes.error}，不能创建独立 worktree`);
  }

  const readDefaultBranch = input.readDefaultBranch || getDefaultBranch;
  const defaultBranchRes = await readDefaultBranch(input.repoPath);
  if (!defaultBranchRes.success) return defaultBranchRes;

  const { repoOwner, repoName } = repositoryRes.data;
  const taskDir = getTaskDataDir(input.snapshot, repoOwner, repoName);
  return success({
    runner,
    snapshot: input.snapshot,
    repoPath: input.repoPath,
    worktreePath:
      input.snapshot.task.workspaceMode === TASK_WORKSPACE_MODE.DEFAULT_BRANCH
        ? input.repoPath
        : input.snapshot.task.worktreePath || path.join(taskDir, 'worktree'),
    branchName:
      input.snapshot.task.workspaceMode === TASK_WORKSPACE_MODE.DEFAULT_BRANCH
        ? defaultBranchRes.data
        : await resolveBranchName(input, runner),
    defaultBranch: defaultBranchRes.data,
    workspaceMode: input.snapshot.task.workspaceMode,
  });
}

async function ensureTaskWorktreeReady(context: TaskWorktreeContext) {
  if (context.workspaceMode === TASK_WORKSPACE_MODE.DEFAULT_BRANCH) {
    return ensureDefaultBranchReady(context);
  }

  if (await isGitWorktree(context.runner, context.worktreePath)) {
    const switchRes = await runGit(context.runner, context.worktreePath, [
      'switch',
      context.branchName,
    ]);
    return switchRes.success
      ? success(null)
      : failure(`切换 Task worktree 分支失败: ${switchRes.error}`);
  }

  if (fs.existsSync(context.worktreePath)) {
    return failure(
      `Task worktree 路径已存在但不是 Git worktree: ${context.worktreePath}`,
    );
  }
  return createTaskWorktree(context);
}

function recordTaskWorktree(context: TaskWorktreeContext) {
  return updateTaskDelivery({
    taskId: context.snapshot.task.taskId,
    branchName: context.branchName,
    worktreePath: context.worktreePath,
  });
}

export async function prepareTaskWorktree(
  input: PrepareTaskWorktreeInput,
): Promise<Result<PrepareTaskWorktreeOutput>> {
  const contextRes = await resolveTaskWorktreeContext(input);
  if (!contextRes.success) return contextRes;
  const context = contextRes.data;

  const syncRes = await syncDefaultBranch(context);
  if (!syncRes.success) return syncRes;

  const worktreeRes = await ensureTaskWorktreeReady(context);
  if (!worktreeRes.success) return worktreeRes;

  const updateRes = recordTaskWorktree(context);
  if (!updateRes.success) return updateRes;

  return success({
    worktreePath: context.worktreePath,
    branchName: context.branchName,
    defaultBranch: context.defaultBranch,
    workspaceMode: context.workspaceMode,
  });
}
