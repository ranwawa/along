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
  return success(typeof result.stdout === 'string' ? result.stdout.trim() : '');
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

export async function prepareTaskWorktree(
  input: PrepareTaskWorktreeInput,
): Promise<Result<PrepareTaskWorktreeOutput>> {
  const { snapshot } = input;
  const runner = input.commandRunner || defaultTaskWorktreeCommandRunner;
  const readDefaultBranch = input.readDefaultBranch || getDefaultBranch;

  const repositoryRes = await ensureTaskRepository(
    snapshot,
    input.repoPath,
    runner,
  );
  if (!repositoryRes.success) {
    return failure(`${repositoryRes.error}，不能创建独立 worktree`);
  }
  const { repoOwner, repoName } = repositoryRes.data;

  const defaultBranchRes = await readDefaultBranch(input.repoPath);
  if (!defaultBranchRes.success) return defaultBranchRes;
  const defaultBranch = defaultBranchRes.data;

  const taskDir =
    snapshot.task.seq != null
      ? config.getTaskDirBySeq(repoOwner, repoName, snapshot.task.seq)
      : config.getTaskDir(repoOwner, repoName, snapshot.task.taskId);
  const worktreePath =
    snapshot.task.worktreePath || path.join(taskDir, 'worktree');
  const branchName =
    snapshot.task.branchName ||
    (await generateTaskBranchName(
      runner,
      input.repoPath,
      snapshot.task.taskId,
      snapshot.task.title,
      snapshot.task.seq,
      snapshot.task.type,
    ));

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

  const fetchRes = await runGit(runner, input.repoPath, [
    'fetch',
    'origin',
    defaultBranch,
  ]);
  if (!fetchRes.success) {
    return failure(`同步远端默认分支失败: ${fetchRes.error}`);
  }

  await runGit(runner, input.repoPath, ['worktree', 'prune']);

  if (await isGitWorktree(runner, worktreePath)) {
    const switchRes = await runGit(runner, worktreePath, [
      'switch',
      branchName,
    ]);
    if (!switchRes.success) {
      return failure(`切换 Task worktree 分支失败: ${switchRes.error}`);
    }
  } else if (fs.existsSync(worktreePath)) {
    return failure(
      `Task worktree 路径已存在但不是 Git worktree: ${worktreePath}`,
    );
  } else {
    const addArgs = snapshot.task.branchName
      ? ['worktree', 'add', worktreePath, branchName]
      : [
          'worktree',
          'add',
          '-B',
          branchName,
          worktreePath,
          `origin/${defaultBranch}`,
        ];
    const addRes = await runGit(runner, input.repoPath, addArgs);
    if (!addRes.success) {
      return failure(`创建 Task worktree 失败: ${addRes.error}`);
    }
  }

  const updateRes = updateTaskDelivery({
    taskId: snapshot.task.taskId,
    status: snapshot.task.status,
    branchName,
    worktreePath,
  });
  if (!updateRes.success) return updateRes;

  return success({ worktreePath, branchName, defaultBranch });
}
