// biome-ignore-all lint/suspicious/noExplicitAny: legacy shared helper keeps external error shapes untyped.
// biome-ignore-all lint/style/noMagicNumbers: legacy time formatting constants are outside this migration.
import { createRequire } from 'node:module';
import { consola } from 'consola';
import { config } from './config';

// simple-git 的 ESM bundle 中 debug 模块在 Bun 下 default export 为 undefined
// 通过 createRequire 强制走 CJS 入口规避此问题
const require = createRequire(import.meta.url);
const { simpleGit } = require('simple-git');

export const git = simpleGit();

const gitCache = new Map<string, ReturnType<typeof simpleGit>>();

export function getGit(repoPath: string): ReturnType<typeof simpleGit> {
  let instance = gitCache.get(repoPath);
  if (!instance) {
    instance = simpleGit(repoPath);
    gitCache.set(repoPath, instance);
  }
  return instance;
}

export type { Result } from './result';

import { failure, success } from './result';

export { failure, success };

let cachedIsRepo: boolean | null = null;

// 检查目录是否在 git 仓库中
export async function checkGitRepo(): Promise<Result<boolean>> {
  if (cachedIsRepo) return success(true);

  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return failure('当前目录不是 git 仓库');
    cachedIsRepo = true;
    return success(true);
  } catch (e: any) {
    return failure(`检查 git 仓库失败: ${e.message}`);
  }
}

// 获取仓库根目录
export async function get_repo_root(): Promise<string> {
  const root = await git.revparse(['--show-toplevel']);
  return root.trim();
}

// 计算运行时间
export function calculate_runtime(startTime: string): string {
  const start = new Date(startTime).getTime();
  if (Number.isNaN(start)) return '未知';

  const diffSeconds = Math.floor((Date.now() - start) / 1000);

  if (diffSeconds < 60) {
    return `${diffSeconds}s`;
  } else if (diffSeconds < 3600) {
    return `${Math.floor(diffSeconds / 60)}m`;
  } else {
    return `${Math.floor(diffSeconds / 3600)}h${Math.floor((diffSeconds % 3600) / 60)}m`;
  }
}

// 检查进程是否正在运行
export async function check_process_running(
  pid: number | string,
): Promise<boolean> {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

// 生成时间戳 ISO 格式
export function iso_timestamp(): string {
  return new Date().toISOString();
}

let cachedRepoInfo: { owner: string; repo: string } | null = null;

export async function readRepoInfo(): Promise<
  Result<{ owner: string; repo: string }>
> {
  if (cachedRepoInfo) return success(cachedRepoInfo);
  try {
    const remoteStr = await git.remote(['get-url', 'origin']);
    const remote = typeof remoteStr === 'string' ? remoteStr.trim() : '';
    if (!remote) return failure('无法获取 git 远程仓库 origin 信息');
    const match = remote.match(/[:/]([^/]+)\/([^/]+?)(\.git)?$/);
    if (!match) return failure(`无法解析远程仓库地址: ${remote}`);
    cachedRepoInfo = { owner: match[1], repo: match[2].trim() };
    return success(cachedRepoInfo);
  } catch (e: any) {
    return failure(`无法获取 git 远程仓库 origin 信息: ${e.message}`);
  }
}

const commonLogger = consola.withTag('common');

/**
 * 确保 worktree 中的运行时配置包含 ~/.along/ 目录的访问权限
 */
export function ensureRuntimePermissions(worktreePath: string) {
  const runtimeRes = config.getLogTag();
  if (!runtimeRes.success) {
    commonLogger.error(runtimeRes.error);
    return;
  }
  const runtime = config.RUNTIMES.find((e) => e.id === runtimeRes.data);
  if (!runtime?.ensurePermissions) return;

  try {
    runtime.ensurePermissions(worktreePath, config.USER_ALONG_DIR);
    commonLogger.info(
      `已自动授权 ${runtime.name} 访问 ${config.USER_ALONG_DIR}/`,
    );
  } catch (e: any) {
    commonLogger.warn(`自动授权 ${runtime.name} 失败: ${e.message}`);
  }
}
