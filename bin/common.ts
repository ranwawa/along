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
  const editorId = editorRes.data;

  if (editorId === "opencode") {
    ensureOpenCodePermissions(worktreePath);
  } else if (editorId === "claude") {
    ensureClaudePermissions(worktreePath);
  }
}

function ensureOpenCodePermissions(worktreePath: string) {
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

function ensureClaudePermissions(worktreePath: string) {
  const claudeDir = path.join(worktreePath, ".claude");
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  const configPath = path.join(claudeDir, "settings.local.json");
  let existing: any = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      existing = {};
    }
  }

  const permissions = existing.permissions || {};
  const allow: string[] = permissions.allow || [];

  const alongBashPattern = `Bash(along *)`;
  const alongReadPattern = `Read(${config.USER_ALONG_DIR}/**)`;
  const alongEditPattern = `Edit(${config.USER_ALONG_DIR}/**)`;

  const requiredPatterns = [alongBashPattern, alongReadPattern, alongEditPattern];
  const missing = requiredPatterns.filter((p) => !allow.includes(p));

  if (missing.length === 0) return;

  allow.push(...missing);
  permissions.allow = allow;
  existing.permissions = permissions;

  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n");
  commonLogger.info(`已自动授权 claude 访问 ${config.USER_ALONG_DIR}/`);
}

