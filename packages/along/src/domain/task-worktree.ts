import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../core/config';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  type TaskPlanningSnapshot,
  updateTaskDelivery,
  updateTaskRepository,
} from './task-planning';
import { getDefaultBranch } from './worktree-init';

export interface TaskWorktreeCommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export type TaskWorktreeCommandRunner = (
  command: string,
  args: string[],
  options: TaskWorktreeCommandOptions,
) => Promise<Result<string>>;

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

function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/_/g, '-')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 36)
    .replace(/^-|-$/g, '');
  return slug || 'task';
}

async function runGit(
  runner: TaskWorktreeCommandRunner,
  cwd: string,
  args: string[],
): Promise<Result<string>> {
  return runner('git', args, { cwd });
}

function parseGitHubRemoteUrl(
  remote: string,
): { repoOwner: string; repoName: string } | null {
  const trimmed = remote.trim();
  const match = trimmed.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
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

  const parsed = parseGitHubRemoteUrl(remoteRes.data);
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

async function branchExists(
  runner: TaskWorktreeCommandRunner,
  repoPath: string,
  branchName: string,
): Promise<boolean> {
  const result = await runGit(runner, repoPath, [
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/heads/${branchName}`,
  ]);
  return result.success;
}

export async function generateTaskBranchName(
  runner: TaskWorktreeCommandRunner,
  repoPath: string,
  taskId: string,
  title: string,
  seq?: number,
  type?: string,
): Promise<string> {
  const prefix = type || 'feat';
  const slug = slugifyTitle(title);
  const suffix =
    seq != null ? `-${seq}` : `-${taskId.replace(/^task_/, '').slice(0, 8)}`;
  const base = `${prefix}/${slug}${suffix}`;
  if (!(await branchExists(runner, repoPath, base))) return base;

  for (let index = 2; index <= 20; index += 1) {
    const candidate = `${base}-${index}`;
    if (!(await branchExists(runner, repoPath, candidate))) return candidate;
  }

  return `${base}-${Date.now().toString(36)}`;
}

async function isGitWorktree(
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

interface TaskWorktreeContext {
  runner: TaskWorktreeCommandRunner;
  snapshot: TaskPlanningSnapshot;
  repoPath: string;
  worktreePath: string;
  branchName: string;
  defaultBranch: string;
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
      input.snapshot.task.worktreePath || path.join(taskDir, 'worktree'),
    branchName: await resolveBranchName(input, runner),
    defaultBranch: defaultBranchRes.data,
  });
}

async function syncDefaultBranch(context: TaskWorktreeContext) {
  fs.mkdirSync(path.dirname(context.worktreePath), { recursive: true });
  const fetchRes = await runGit(context.runner, context.repoPath, [
    'fetch',
    'origin',
    context.defaultBranch,
  ]);
  if (!fetchRes.success) {
    return failure(`同步远端默认分支失败: ${fetchRes.error}`);
  }
  await runGit(context.runner, context.repoPath, ['worktree', 'prune']);
  return success(null);
}

async function createTaskWorktree(context: TaskWorktreeContext) {
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

async function ensureTaskWorktreeReady(context: TaskWorktreeContext) {
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
  });
}
