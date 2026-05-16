/**
 * worktree-init.ts - Worktree 初始化核心逻辑
 * 供 run.ts 直接调用
 */

import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { consola } from 'consola';
import { failure, getErrorMessage, getGit, git, success } from '../core/common';

const logger = consola.withTag('worktree-init');

import type { Result } from '../core/common';
import type { RuntimeConfig } from '../core/config';
import { config } from '../core/config';

export async function getDefaultBranch(
  repoPath?: string,
): Promise<Result<string>> {
  try {
    const g = repoPath ? getGit(repoPath) : git;
    const remoteInfo = await g.raw(['remote', 'show', 'origin']);
    const match = remoteInfo.match(/HEAD branch: (.+)/);
    if (match?.[1]) {
      return success(match[1].trim());
    }
  } catch {
    // 如果获取失败，回退到 master
  }
  return success('master');
}

function clearExistingPath(worktreePath: string): Result<null> {
  if (!fs.existsSync(worktreePath)) return success(null);
  if (fs.existsSync(path.join(worktreePath, '.along/issue-mark')))
    return success(null);
  // planning 阶段创建的软链需要先清理再创建真正的 worktree
  try {
    const stat = fs.lstatSync(worktreePath);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(worktreePath);
      logger.info('已清理 planning 阶段的软链工作目录');
      return success(null);
    }
  } catch {}
  return failure(`工作目录存在但非本工具创建，请手动检查: ${worktreePath}`);
}

async function fetchAndCreateWorktree(
  g: ReturnType<typeof getGit>,
  worktreePath: string,
  defaultBranch: string,
): Promise<Result<null>> {
  logger.info('获取远程最新代码...');
  try {
    await g.fetch('origin', defaultBranch);
  } catch (error: unknown) {
    return failure(`fetch 远程分支失败: ${getErrorMessage(error)}`);
  }
  console.log(chalk.green('✓'), '获取远程最新代码完成');

  logger.info('创建 worktree...');
  try {
    try {
      await g.raw(['worktree', 'prune']);
    } catch (_e) {}
    await g.raw([
      'worktree',
      'add',
      '-f',
      '--detach',
      worktreePath,
      `origin/${defaultBranch}`,
    ]);
  } catch (error: unknown) {
    return failure(`创建 worktree 失败: ${getErrorMessage(error)}`);
  }
  console.log(chalk.green('✓'), '创建 worktree 完成');
  return success(null);
}

export async function setupWorktree(
  worktreePath: string,
  repoPath?: string,
): Promise<Result<null>> {
  const clearRes = clearExistingPath(worktreePath);
  if (!clearRes.success) return clearRes;

  const defaultBranchRes = await getDefaultBranch(repoPath);
  if (!defaultBranchRes.success) return defaultBranchRes;
  const defaultBranch = defaultBranchRes.data;

  logger.info(`检测到远程默认分支: ${defaultBranch}`);

  const g = repoPath ? getGit(repoPath) : git;
  return fetchAndCreateWorktree(g, worktreePath, defaultBranch);
}

export function setupPlanningWorkspace(
  worktreePath: string,
  repoRoot: string,
): Result<null> {
  if (fs.existsSync(worktreePath)) {
    try {
      const stat = fs.lstatSync(worktreePath);
      if (stat.isSymbolicLink()) return success(null);
      if (fs.existsSync(path.join(worktreePath, '.along/issue-mark')))
        return success(null);
    } catch {}
    return failure(`工作目录已存在，请手动检查: ${worktreePath}`);
  }

  try {
    fs.symlinkSync(repoRoot, worktreePath, 'dir');
  } catch (error: unknown) {
    return failure(`创建 planning 工作目录软链失败: ${getErrorMessage(error)}`);
  }
  logger.info('已创建 planning 工作目录（软链到主仓库）');
  return success(null);
}

function removeTargetPath(targetPath: string): Result<void> {
  let stat: fs.Stats | null = null;
  try {
    stat = fs.lstatSync(targetPath);
  } catch {
    return success(undefined);
  }

  try {
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(targetPath);
    } else {
      fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 3 });
    }
    return success(undefined);
  } catch (rmError: unknown) {
    logger.warn(`删除目标失败，尝试强制移除: ${getErrorMessage(rmError)}`);
    const backupPath = `${targetPath}.backup-${Date.now()}`;
    try {
      fs.renameSync(targetPath, backupPath);
      fs.rmSync(backupPath, { recursive: true, force: true });
      return success(undefined);
    } catch (renameError: unknown) {
      return failure(
        `无法清理目标路径 ${targetPath}: ${getErrorMessage(renameError)}`,
      );
    }
  }
}

function ensureMappingSymlink(
  sourceDir: string,
  targetPath: string,
): Result<void> {
  if (!fs.existsSync(sourceDir)) {
    return failure(`源目录不存在: ${sourceDir}`);
  }

  const removeRes = removeTargetPath(targetPath);
  if (!removeRes.success) return removeRes;

  const targetParentDir = path.dirname(targetPath);
  if (!fs.existsSync(targetParentDir)) {
    fs.mkdirSync(targetParentDir, { recursive: true });
  }

  const relativeSource = path.relative(targetParentDir, sourceDir);
  fs.symlinkSync(relativeSource, targetPath, 'dir');
  return success(undefined);
}

export function syncRuntimeMappings(
  worktreePath: string,
  runtime: RuntimeConfig,
): Result<void> {
  if (runtime.mappings.length === 0) {
    return success(undefined);
  }

  for (const mapping of runtime.mappings) {
    const sourceDir = path.join(config.ROOT_DIR, mapping.from);
    const targetPath = path.join(worktreePath, mapping.to);

    const linkRes = ensureMappingSymlink(sourceDir, targetPath);
    if (!linkRes.success) {
      logger.error(`  同步失败 (${mapping.to}): ${linkRes.error}`);
      return failure(`同步运行时环境 ${mapping.to} 失败: ${linkRes.error}`);
    }

    logger.info(`  已软链: ${chalk.cyan(mapping.to)}`);
  }

  return success(undefined);
}
