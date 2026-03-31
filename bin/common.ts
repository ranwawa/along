import { consola } from "consola";
import { simpleGit } from "simple-git";

import { config } from "./config";

// 导出 consola 实例供直接使用
export const logger = consola.withTag(config.getLogTag());
export const git = simpleGit();

// 日志函数 (保持兼容性，但内部改用 consola)
export function log_info(message: string) {
  logger.info(message);
}

export function log_warn(message: string) {
  logger.warn(message);
}

export function log_error(message: string) {
  logger.error(message);
}

export function log_success(message: string) {
  logger.success(message);
}

export type Result<T> = { success: true; data: T } | { success: false; error: string };

export function success<T>(data: T, log?: string): Result<T> {
  if (log) {
    logger.success(log)
  }

  return { success: true, data };
}

export function failure<T>(error: string): Result<T> {
  logger.error(error)
  return { success: false, error };
}

let cachedIsRepo: boolean | null = null;

// 检查目录是否在 git 仓库中
export async function checkGitRepo(): Promise<Result<boolean>> {
  if (cachedIsRepo) return success(true);

  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return failure("当前目录不是 git 仓库");
    cachedIsRepo = true;
    return success(true, "本地git仓库检测通过");
  } catch (e: any) {
    return failure(`检查 git 仓库失败: ${e.message}`);
  }
}


// 获取仓库根目录
export async function get_repo_root(): Promise<string> {
  const root = await git.revparse(["--show-toplevel"]);
  return root.trim();
}

// 计算运行时间
export function calculate_runtime(startTime: string): string {
  const start = new Date(startTime).getTime();
  if (isNaN(start)) return "未知";
  
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
export async function check_process_running(pid: number | string): Promise<boolean> {
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
