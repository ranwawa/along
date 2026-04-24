import { $ } from "bun";
import { consola } from "consola";
import {
  check_process_running,
  success,
  failure,
} from "../core/common";
import type { Result } from "../core/common";
import { readRepoInfo } from "../integration/github-client";

const logger = consola.withTag("cleanup-utils");
import { config } from "../core/config";
import fs from "fs";
import { SessionPathManager } from "../core/session-paths";
import { SessionManager } from "./session-manager";
import { readSession } from "../core/db";
import { isActiveSessionStatus } from "./session-state-machine";

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
  owner: string,
  repo: string,
  issueNumber: number,
  options: CleanupOptions,
): Promise<{ canProceed: boolean; error?: string }> {
  const res = readSession(owner, repo, issueNumber);
  if (!res.success) return { canProceed: false, error: res.error };
  const data = res.data;
  if (!data) return { canProceed: true };
  if (!isActiveSessionStatus(data.lifecycle)) return { canProceed: true };

  const pid = data.pid || 0;
  if (!pid || !(await check_process_running(pid))) return { canProceed: true };

  if (!options.force) {
    const tagRes = config.getLogTag();
    const tag = tagRes.success ? tagRes.data : "along";
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
export async function cleanupWorktree(worktreePath: string, silent?: boolean, session?: SessionManager, repoPath?: string) {
  const cwd = repoPath || process.cwd();
  const worktreeList = await $`git worktree list`.cwd(cwd).text();
  if (!fs.existsSync(worktreePath) && !worktreeList.includes(worktreePath)) {
    info(`worktree 目录不存在: ${worktreePath}`, silent);
    return;
  }

  info(`删除 worktree: ${worktreePath}`, silent);
  try {
    await $`git worktree remove ${worktreePath} --force`.cwd(cwd).quiet();
    session?.logEvent("worktree-removed", { worktreePath, method: "git-worktree-remove" });
  } catch {
    warn("git worktree remove 失败，尝试手动删除...", silent);
    await $`rm -rf ${worktreePath}`;
    session?.logEvent("worktree-removed", { worktreePath, method: "rm-rf-fallback" });
  }
}

/** 删除本地 git 分支 */
export async function cleanupBranch(branchName: string, silent?: boolean, session?: SessionManager, repoPath?: string) {
  if (!branchName) return;

  const cwd = repoPath || process.cwd();
  const branches = await $`git branch --list ${branchName}`.cwd(cwd).text();
  if (branches.includes(branchName)) {
    info(`删除本地分支: ${branchName}`, silent);
    await $`git branch -D ${branchName}`.cwd(cwd).quiet().nothrow();
    session?.logEvent("branch-deleted", { branchName });
  }
}

/**
 * 从数据库读取 branchName
 */
export function readBranchName(owner: string, repo: string, issueNumber: number): string {
  const res = readSession(owner, repo, issueNumber);
  if (!res.success || !res.data) return "";
  return res.data.context?.branchName || "";
}

/**
 * 完整清理一个 Issue 的所有资源
 */
export async function cleanupIssue(
  issueNumber: string,
  options: CleanupOptions = {},
  owner?: string,
  repo?: string,
  repoPath?: string,
): Promise<Result<void>> {
  // 如果没有传入 owner/repo，尝试从 git remote 获取
  if (!owner || !repo) {
    const repoInfoRes = await readRepoInfo();
    if (!repoInfoRes.success) {
      logger.error(`无法获取仓库信息: ${repoInfoRes.error}`);
      return failure(repoInfoRes.error);
    }
    owner = repoInfoRes.data.owner;
    repo = repoInfoRes.data.repo;
  }

  const paths = new SessionPathManager(owner, repo, Number(issueNumber));
  const session = new SessionManager(owner, repo, Number(issueNumber));
  const worktreePath = paths.getWorktreeDir();
  const reason = options.reason || (options.force ? "force" : "normal");

  session.logEvent("cleanup-started", { issueNumber, reason, force: !!options.force });

  // 检查进程并决定是否继续
  const processCheck = await checkAndKillProcess(owner, repo, Number(issueNumber), options);
  if (!processCheck.canProceed) {
    if (processCheck.error) logger.error(processCheck.error);
    return failure(processCheck.error || "进程检查失败，无法继续清理");
  }

  // 读取分支名（必须在归档前读取）
  const branchName = readBranchName(owner, repo, Number(issueNumber));

  // 清理 worktree
  await cleanupWorktree(worktreePath, options.silent, session, repoPath);

  // 删除本地分支
  await cleanupBranch(branchName, options.silent, session, repoPath);

  session.logEvent("cleanup-completed", { issueNumber, reason, branchName });
  return success(undefined);
}

/**
 * 彻底清理一个 Issue 的所有本地资源
 * 包括：进程、worktree、分支、SQLite 记录、issue 数据目录（日志、诊断、agent 数据等）
 */
export async function cleanupIssueAssets(
  issueNumber: string,
  options: CleanupOptions = {},
  owner?: string,
  repo?: string,
  repoPath?: string,
): Promise<Result<void>> {
  if (!owner || !repo) {
    const repoInfoRes = await readRepoInfo();
    if (!repoInfoRes.success) {
      logger.error(`无法获取仓库信息: ${repoInfoRes.error}`);
      return failure(repoInfoRes.error);
    }
    owner = repoInfoRes.data.owner;
    repo = repoInfoRes.data.repo;
  }

  const issueNumberNum = Number(issueNumber);
  const paths = new SessionPathManager(owner, repo, issueNumberNum);
  const session = new SessionManager(owner, repo, issueNumberNum);
  const reason = options.reason || (options.force ? "force" : "normal");
  const sessionRes = readSession(owner, repo, issueNumberNum);
  if (!sessionRes.success) return failure(sessionRes.error);

  session.logEvent("cleanup-started", {
    issueNumber,
    reason,
    force: !!options.force,
    scope: "all-assets",
  });

  const processCheck = await checkAndKillProcess(owner, repo, issueNumberNum, options);
  if (!processCheck.canProceed) {
    if (processCheck.error) logger.error(processCheck.error);
    return failure(processCheck.error || "进程检查失败，无法继续清理");
  }

  const worktreePath = sessionRes.data?.worktreePath || paths.getWorktreeDir();
  const branchName = sessionRes.data?.context?.branchName || "";

  await cleanupWorktree(worktreePath, options.silent, session, repoPath);
  await cleanupBranch(branchName, options.silent, session, repoPath);

  const issueDir = paths.getIssueDir();
  if (fs.existsSync(issueDir)) {
    info(`删除本地数据目录: ${issueDir}`, options.silent);
    try {
      fs.rmSync(issueDir, { recursive: true, force: true });
    } catch (e: any) {
      return failure(`删除本地数据目录失败: ${e.message}`);
    }
  }

  return success(undefined);
}
