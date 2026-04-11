import { $ } from "bun";
import { consola } from "consola";
import {
  check_process_running,
  iso_timestamp,
  Result,
  success,
  failure,
} from "./common";
import { get_gh_client, readRepoInfo } from "./github-client";

const logger = consola.withTag("cleanup-utils");
import { config } from "./config";
import fs from "fs";
import { SessionPathManager } from "./session-paths";
import { SessionManager } from "./session-manager";
import { exportAgentSession } from "./agent-session-export";
import { readSession } from "./db";

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
  if (data.status !== "running") return { canProceed: true };

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
export async function cleanupWorktree(worktreePath: string, silent?: boolean, session?: SessionManager) {
  const worktreeList = await $`git worktree list`.text();
  if (!fs.existsSync(worktreePath) && !worktreeList.includes(worktreePath)) {
    info(`worktree 目录不存在: ${worktreePath}`, silent);
    return;
  }

  info(`删除 worktree: ${worktreePath}`, silent);
  try {
    await $`git worktree remove ${worktreePath} --force`.quiet();
    session?.logEvent("worktree-removed", { worktreePath, method: "git-worktree-remove" });
  } catch {
    warn("git worktree remove 失败，尝试手动删除...", silent);
    await $`rm -rf ${worktreePath}`;
    session?.logEvent("worktree-removed", { worktreePath, method: "rm-rf-fallback" });
  }
}

/** 删除本地 git 分支 */
export async function cleanupBranch(branchName: string, silent?: boolean, session?: SessionManager) {
  if (!branchName) return;

  const branches = await $`git branch --list ${branchName}`.text();
  if (branches.includes(branchName)) {
    info(`删除本地分支: ${branchName}`, silent);
    await $`git branch -D ${branchName}`.quiet().nothrow();
    session?.logEvent("branch-deleted", { branchName });
  }
}

/** 归档 session：在数据库中标记 cleanupTime/cleanupReason */
export async function archiveSession(
  owner: string,
  repo: string,
  issueNumber: number,
  reason: string,
  silent?: boolean,
  session?: SessionManager,
) {
  session?.writeStatus({
    cleanupTime: iso_timestamp(),
    cleanupReason: reason,
  });
  info(`会话状态已标记清理: ${owner}/${repo}#${issueNumber}`, silent);
  session?.logEvent("session-archived", { reason });
}

/**
 * 从数据库读取 branchName
 */
export function readBranchName(owner: string, repo: string, issueNumber: number): string {
  const res = readSession(owner, repo, issueNumber);
  if (!res.success || !res.data) return "";
  return res.data.branchName || "";
}

/**
 * 完整清理一个 Issue 的所有资源
 */
export async function cleanupIssue(
  issueNumber: string,
  options: CleanupOptions = {},
  owner?: string,
  repo?: string,
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
    return;
  }

  // PR 合并时兜底移除 WIP 标签
  if (reason === "pr-merged") {
    try {
      const clientRes = await get_gh_client();
      if (clientRes.success) {
        await clientRes.data.removeIssueLabel(issueNumber, "WIP");
        info("WIP 标签已移除", options.silent);
        session.logEvent("label-removed", { issueNumber, label: "WIP" });
      }
    } catch {
      // 标签可能已被移除，忽略错误
    }
  }

  // 读取分支名（必须在归档前读取）
  const branchName = readBranchName(owner, repo, Number(issueNumber));

  // 导出 agent 会话数据（必须在 worktree 删除前执行）
  try {
    await exportAgentSession(paths, worktreePath, session);
  } catch (e: any) {
    warn(`导出 agent 会话数据失败: ${e.message}`, options.silent);
  }

  // 清理 worktree
  await cleanupWorktree(worktreePath, options.silent, session);

  // 删除本地分支
  await cleanupBranch(branchName, options.silent, session);

  // 归档（在数据库中标记清理信息）
  await archiveSession(owner, repo, Number(issueNumber), reason, options.silent, session);

  session.logEvent("cleanup-completed", { issueNumber, reason, branchName });
  return success(undefined);
}
