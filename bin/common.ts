import { simpleGit } from "simple-git";
import fs from "fs";
import path from "path";
import { consola } from "consola";
import { config } from "./config";

export const git = simpleGit();

export type Result<T> = { success: true; data: T } | { success: false; error: string };

export function success<T>(data: T): Result<T> {
  return { success: true, data };
}

export function failure<T>(error: string): Result<T> {
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

// Session ID 相关工具函数
export interface RepoInfo {
  owner: string;
  repo: string;
}

export interface SessionIdentifier extends RepoInfo {
  issueNumber: number;
}

// 生成唯一的 session ID
export function getSessionId(owner: string, repo: string, issueNumber: number): string {
  return `${owner}-${repo}-${issueNumber}`;
}

// 从 session ID 解析出仓库信息和 issue 编号
export function parseSessionId(sessionId: string): Result<SessionIdentifier> {
  const parts = sessionId.split("-");
  if (parts.length < 3) {
    return failure(`Invalid session ID format: ${sessionId}`);
  }
  
  // 尝试找到 issueNumber 的位置（它是最后一个数字部分）
  let issueNumberIndex = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(parts[i])) {
      issueNumberIndex = i;
      break;
    }
  }
  
  if (issueNumberIndex === -1) {
    return failure(`Could not find issue number in session ID: ${sessionId}`);
  }
  
  const issueNumber = Number(parts[issueNumberIndex]);
  const owner = parts.slice(0, issueNumberIndex - 1).join("-");
  const repo = parts.slice(issueNumberIndex - 1, issueNumberIndex).join("-");
  
  return success({ owner, repo, issueNumber });
}

// 判断字符串是否是新格式的 session ID（包含 owner-repo-）
export function isNewFormatSessionId(id: string): boolean {
  return /^[^-]+-[^-]+-\d+$/.test(id);
}

const commonLogger = consola.withTag("common");

/**
 * 确保 worktree 中的编辑器配置包含 ~/.along/ 目录的访问权限
 */
export function ensureEditorPermissions(worktreePath: string) {
  const editorId = config.getLogTag();
  if (editorId !== "opencode") return;

  const configPath = path.join(worktreePath, "opencode.json");
  let existing: any = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      existing = {};
    }
  }

  const alongPattern = `${config.USER_ALONG_DIR}/**`;
  const permission = existing.permission || {};
  const extDir = permission.external_directory || {};

  if (extDir[alongPattern] === "allow") return;

  extDir[alongPattern] = "allow";
  permission.external_directory = extDir;
  existing.permission = permission;
  if (!existing.$schema) {
    existing.$schema = "https://opencode.ai/config.json";
  }

  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n");
  commonLogger.info(`已自动授权 opencode 访问 ${config.USER_ALONG_DIR}/`);
}

