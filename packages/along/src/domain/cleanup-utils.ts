import { $ } from 'bun';
import { consola } from 'consola';
import type { Result } from '../core/common';
import { failure, getGit, git, readRepoInfo, success } from '../core/common';
import { getDefaultBranch } from './worktree-init';

const logger = consola.withTag('cleanup-utils');

import fs from 'node:fs';

export interface CleanupOptions {
  force?: boolean;
  reason?: string;
  silent?: boolean;
  worktreePath?: string;
  branchName?: string;
}

function info(msg: string, silent?: boolean) {
  if (!silent) logger.info(msg);
}

function warn(msg: string, silent?: boolean) {
  if (!silent) logger.warn(msg);
}

async function cleanupWorktree(
  worktreePath: string,
  silent?: boolean,
  repoPath?: string,
) {
  const cwd = repoPath || process.cwd();
  const worktreeList = await $`git worktree list`.cwd(cwd).text();
  if (!fs.existsSync(worktreePath) && !worktreeList.includes(worktreePath)) {
    info(`worktree 目录不存在: ${worktreePath}`, silent);
    return;
  }

  info(`删除 worktree: ${worktreePath}`, silent);
  try {
    await $`git worktree remove ${worktreePath} --force`.cwd(cwd).quiet();
  } catch {
    warn('git worktree remove 失败，尝试手动删除...', silent);
    await $`rm -rf ${worktreePath}`;
  }
}

async function cleanupBranch(
  branchName: string,
  silent?: boolean,
  repoPath?: string,
) {
  if (!branchName) return;
  const cwd = repoPath || process.cwd();
  const branches = await $`git branch --list ${branchName}`.cwd(cwd).text();
  if (branches.includes(branchName)) {
    info(`删除本地分支: ${branchName}`, silent);
    await $`git branch -D ${branchName}`.cwd(cwd).quiet().nothrow();
  }
}

async function pullDefaultBranch(repoPath?: string): Promise<Result<string>> {
  const defaultBranchRes = await getDefaultBranch(repoPath);
  if (!defaultBranchRes.success) return failure(defaultBranchRes.error);
  const defaultBranch = defaultBranchRes.data;
  const g = repoPath ? getGit(repoPath) : git;

  try {
    await g.fetch('origin', defaultBranch);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`fetch 失败: ${message}`);
  }

  let currentBranch = '';
  try {
    currentBranch = (
      await g.raw(['symbolic-ref', '--quiet', '--short', 'HEAD'])
    ).trim();
  } catch {}

  try {
    if (currentBranch === defaultBranch) {
      await g.raw(['merge', '--ff-only', `origin/${defaultBranch}`]);
    } else {
      await g.raw(['branch', '-f', defaultBranch, `origin/${defaultBranch}`]);
    }
    return success(defaultBranch);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`更新本地默认分支失败: ${message}`);
  }
}

export async function cleanupIssue(
  _issueNumber: string,
  options: CleanupOptions = {},
  owner?: string,
  repo?: string,
  repoPath?: string,
): Promise<Result<void>> {
  if (!owner || !repo) {
    const repoInfoRes = await readRepoInfo();
    if (!repoInfoRes.success) return failure(repoInfoRes.error);
    owner = repoInfoRes.data.owner;
    repo = repoInfoRes.data.repo;
  }

  const worktreePath = options.worktreePath;
  const branchName = options.branchName;

  if (worktreePath) {
    await cleanupWorktree(worktreePath, options.silent, repoPath);
  }
  if (branchName) {
    await cleanupBranch(branchName, options.silent, repoPath);
  }

  const pullRes = await pullDefaultBranch(repoPath);
  if (!pullRes.success) {
    warn(`默认分支同步失败: ${pullRes.error}`, options.silent);
  }

  return success(undefined);
}
