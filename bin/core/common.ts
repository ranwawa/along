import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { consola } from "consola";
import { config } from "./config";

// simple-git 的 ESM bundle 中 debug 模块在 Bun 下 default export 为 undefined
// 通过 createRequire 强制走 CJS 入口规避此问题
const require = createRequire(import.meta.url);
const { simpleGit } = require("simple-git");

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

export type { Result } from "./result";
import { success, failure } from "./result";
export { success, failure };

let cachedIsRepo: boolean | null = null;

// 检查目录是否在 git 仓库中
export async function checkGitRepo(): Promise<Result<boolean>> {
  if (cachedIsRepo) return success(true);

  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return failure("当前目录不是 git 仓库");
    cachedIsRepo = true;
    return success(true);
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

const commonLogger = consola.withTag("common");

/**
 * 确保 worktree 中的编辑器配置包含 ~/.along/ 目录的访问权限
 */
export function ensureEditorPermissions(worktreePath: string) {
  const editorRes = config.getLogTag();
  if (!editorRes.success) {
    commonLogger.error(editorRes.error);
    return;
  }
  const editor = config.EDITORS.find(e => e.id === editorRes.data);
  if (!editor?.ensurePermissions) return;

  try {
    editor.ensurePermissions(worktreePath, config.USER_ALONG_DIR);
    commonLogger.info(`已自动授权 ${editor.name} 访问 ${config.USER_ALONG_DIR}/`);
  } catch (e: any) {
    commonLogger.warn(`自动授权 ${editor.name} 失败: ${e.message}`);
  }
}

