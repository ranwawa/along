import { $ } from "bun";
import { consola } from "consola";
import {
  check_process_running,
  iso_timestamp,
} from "./common";

const logger = consola.withTag("cleanup-utils");
import { config } from "./config";
import path from "path";
import fs from "fs";

export interface CleanupOptions {
  force?: boolean;
  reason?: string; // "normal" | "force" | "gc"
  silent?: boolean;
}

function info(msg: string, silent?: boolean) {
  if (!silent) logger.info(msg);
}

function warn(msg: string, silent?: boolean) {
  if (!silent) logger.warn(msg);
}

/**
 * 检查 session 进程是否仍在运行，如果 force 则杀掉
 * 返回 true 表示可以继续清理，false 表示应跳过
 */
export async function checkAndKillProcess(
  statusFile: string,
  issueNumber: string,
  options: CleanupOptions,
): Promise<{ canProceed: boolean; error?: string }> {
  if (!fs.existsSync(statusFile)) return { canProceed: true };

  const data = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
  if (data.status !== "running") return { canProceed: true };

  const pid = data.pid || "";
  if (!pid || !(await check_process_running(pid))) return { canProceed: true };

  if (!options.force) {
    const tag = config.getLogTag();
    return {
      canProceed: false,
      error: `Issue #${issueNumber} 仍在运行中 (PID: ${pid})\n如需强制清理，请使用: ${tag} cleanup ${issueNumber} --force`,
    };
  }

  warn(`强制终止进程 PID: ${pid}`, options.silent);
  try {
    process.kill(Number(pid), 9);
  } catch {}
  return { canProceed: true };
}

/** 删除 worktree 目录 */
export async function cleanupWorktree(worktreePath: string, silent?: boolean) {
  const worktreeList = await $`git worktree list`.text();
  if (!fs.existsSync(worktreePath) && !worktreeList.includes(worktreePath)) {
    info(`worktree 目录不存在: ${worktreePath}`, silent);
    return;
  }

  info(`删除 worktree: ${worktreePath}`, silent);
  try {
    await $`git worktree remove ${worktreePath} --force`.quiet();
  } catch {
    warn("git worktree remove 失败，尝试手动删除...", silent);
    await $`rm -rf ${worktreePath}`;
  }
}

/** 删除本地 git 分支 */
export async function cleanupBranch(branchName: string, silent?: boolean) {
  if (!branchName) return;

  const branches = await $`git branch --list ${branchName}`.text();
  if (branches.includes(branchName)) {
    info(`删除本地分支: ${branchName}`, silent);
    await $`git branch -D ${branchName}`.quiet().nothrow();
  }
}

/** 归档 session 文件和 log 文件到统一产物目录 */
export async function archiveFiles(issueNumber: string, reason: string, silent?: boolean) {
  const artifactDir = path.join(config.ARTIFACT_DIR, issueNumber);
  fs.mkdirSync(artifactDir, { recursive: true });

  // 归档 sessions 目录下所有 {issueNumber}-* 文件
  const sessionFiles = fs.existsSync(config.SESSION_DIR)
    ? fs.readdirSync(config.SESSION_DIR).filter(
        (f) => f.startsWith(`${issueNumber}-`) && !fs.statSync(path.join(config.SESSION_DIR, f)).isDirectory(),
      )
    : [];

  for (const file of sessionFiles) {
    const srcPath = path.join(config.SESSION_DIR, file);

    // status.json 特殊处理：注入 cleanupTime 和 cleanupReason
    if (file.endsWith("-status.json")) {
      const data = JSON.parse(fs.readFileSync(srcPath, "utf-8"));
      data.cleanupTime = iso_timestamp();
      data.cleanupReason = reason;
      const archiveFile = path.join(artifactDir, `${issueNumber}-status.json`);
      await Bun.write(archiveFile, JSON.stringify(data, null, 2));
      fs.unlinkSync(srcPath);
      info(`状态文件已归档: ${archiveFile}`, silent);
      continue;
    }

    // 其他文件直接移动到产物目录
    const archiveFile = path.join(artifactDir, file);
    fs.renameSync(srcPath, archiveFile);
    info(`文件已归档: ${archiveFile}`, silent);
  }

  // 归档 logs 目录下的 {issueNumber}.log 和 {issueNumber}-*.log
  const logFiles = fs.existsSync(config.LOG_DIR)
    ? fs.readdirSync(config.LOG_DIR).filter(
        (f) => (f === `${issueNumber}.log` || f.startsWith(`${issueNumber}-`)) && f.endsWith(".log"),
      )
    : [];

  for (const file of logFiles) {
    const srcPath = path.join(config.LOG_DIR, file);
    const archiveFile = path.join(artifactDir, file);
    fs.renameSync(srcPath, archiveFile);
    info(`日志已归档: ${archiveFile}`, silent);
  }
}

/**
 * 读取 status 文件中的 branchName
 */
export function readBranchName(statusFile: string): string {
  if (!fs.existsSync(statusFile)) return "";
  try {
    const data = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
    return data.branchName || data.headRef || "";
  } catch {
    return "";
  }
}

/**
 * 完整清理一个 Issue 的所有资源
 */
export async function cleanupIssue(issueNumber: string, options: CleanupOptions = {}) {
  const statusFile = path.join(config.SESSION_DIR, `${issueNumber}-status.json`);
  const worktreePath = path.join(config.WORKTREE_DIR, `${issueNumber}`);
  const reason = options.reason || (options.force ? "force" : "normal");

  // 读取分支名（必须在归档前读取）
  const branchName = readBranchName(statusFile);

  // 清理 worktree
  await cleanupWorktree(worktreePath, options.silent);

  // 删除本地分支
  await cleanupBranch(branchName, options.silent);

  // 归档所有相关文件
  await archiveFiles(issueNumber, reason, options.silent);
}
