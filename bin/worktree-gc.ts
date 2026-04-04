#!/usr/bin/env bun
import { $ } from "bun";
import { consola } from "consola";
import {
  checkGitRepo,
  check_process_running,
} from "./common";
import { readRepoInfo } from "./github-client";

const logger = consola.withTag("worktree-gc");
import { get_gh_client, isNotFoundError } from "./github-client";
import type { GitHubClient } from "./github-client";
import chalk from "chalk";
import { config } from "./config";
import { cleanupIssue } from "./cleanup-utils";
import path from "path";
import fs from "fs";

import { Command } from "commander";

// session 文件解析后的结构
interface SessionInfo {
  type: "issue";
  number: string;
  statusFile: string;
  worktreePath: string;
  branchName: string;
  repo?: { owner: string; name: string };
  data: any;
}

// GC 判定结果
interface GcCandidate {
  session: SessionInfo;
  reason: string;
}

/** 扫描 sessions 目录，收集所有 session 信息 */
function scanSessions(sessionsDir: string, worktreesDir: string): SessionInfo[] {
  if (!fs.existsSync(sessionsDir)) return [];

  const files = fs
    .readdirSync(sessionsDir)
    .filter((f) => /^\d+-status\.json$/.test(f));
  const sessions: SessionInfo[] = [];

  for (const file of files) {
    const match = file.match(/^(\d+)-status\.json$/);
    if (!match) continue;

    const [, number] = match;
    const type = "issue";
    const statusFile = path.join(sessionsDir, file);
    const data = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
    const worktreePath = path.join(worktreesDir, `${number}`);
    const branchName = data.branchName || data.headRef || "";

    sessions.push({
      type,
      number,
      statusFile,
      worktreePath,
      branchName,
      repo: data.repo || undefined,
      data,
    });
  }

  return sessions;
}

/** 检查 session 对应的进程是否仍在运行 */
async function isSessionRunning(session: SessionInfo): Promise<boolean> {
  const pid = session.data.pid;
  if (!pid) return false;
  return check_process_running(pid);
}

/** 判断 Issue 类型 session 是否可清理 */
async function checkIssueSession(client: GitHubClient, session: SessionInfo): Promise<string | null> {
  // 优先通过分支名查找关联 PR
  if (session.branchName) {
    try {
      const prs = []; // listPullRequestsByHead 已被删除，暂时设为空
    } catch (e: any) {
      logger.warn(`查找 Issue #${session.number} 关联 PR 失败: ${e.message}`);
    }
  }

  // 回退：检查 issue 本身状态
  try {
    const issue = await client.getIssue(session.number);
    if (issue.state === "closed") return `Issue #${session.number} 已关闭`;
    return null;
  } catch (e: any) {
    if (isNotFoundError(e)) return `Issue #${session.number} 不存在`;
    logger.warn(`检查 Issue #${session.number} 失败: ${e.message}`);
    return null;
  }
}


/** 核心 GC 逻辑（可被 run.ts 导入调用） */
export async function runGc(options: { dryRun?: boolean; force?: boolean; silent?: boolean } = {}) {
  const sessionsDir = config.SESSION_DIR;
  const worktreesDir = config.WORKTREE_DIR;

  const allSessions = scanSessions(sessionsDir, worktreesDir);
  if (allSessions.length === 0) {
    if (!options.silent) logger.info("没有活跃的 session");
    return;
  }

  // 获取当前项目的 owner/repo，用于过滤 session
  const repoInfoRes = await readRepoInfo();
  let currentOwner: string | undefined;
  let currentRepo: string | undefined;
  if (repoInfoRes.success) {
    currentOwner = repoInfoRes.data.owner;
    currentRepo = repoInfoRes.data.repo;
  }

  // 仅处理属于当前项目的 session，跳过其他项目的 session
  const sessions = allSessions.filter(session => {
    if (!session.repo?.owner || !session.repo?.name) {
      // 旧格式 session 没有 repo 信息，保守处理：仅在无法确定当前项目时才处理
      if (!currentOwner || !currentRepo) return true;
      // 有当前项目信息但 session 无 repo 信息，跳过以避免误删
      if (!options.silent) logger.info(`跳过 #${session.number}（session 缺少仓库信息，无法确认归属）`);
      return false;
    }
    if (!currentOwner || !currentRepo) return true;
    const belongs = session.repo.owner === currentOwner && session.repo.name === currentRepo;
    if (!belongs && !options.silent) {
      logger.info(`跳过 #${session.number}（属于 ${session.repo.owner}/${session.repo.name}，非当前项目）`);
    }
    return belongs;
  });

  if (sessions.length === 0) {
    if (!options.silent) logger.info("当前项目没有需要检查的 session");
    return;
  }

  // 获取 GitHub 客户端
  const clientRes = await get_gh_client();
  if (!clientRes.success) {
    if (!options.silent) logger.warn(`无法连接 GitHub API，跳过 GC: ${clientRes.error}`);
    return;
  }
  const client = clientRes.data;

  // 检查每个 session 是否可清理
  const candidates: GcCandidate[] = [];
  for (const session of sessions) {
    // 检查进程是否仍在运行
    if (!options.force && await isSessionRunning(session)) {
      if (!options.silent) logger.info(`跳过 ${session.type} #${session.number}（进程运行中）`);
      continue;
    }

    const reason = await checkIssueSession(client, session);

    if (reason) {
      candidates.push({ session, reason });
    }
  }

  if (candidates.length === 0) {
    if (!options.silent) logger.info("没有需要清理的 worktree");
    return;
  }

  // 输出候选列表
  if (!options.silent) {
    logger.log("");
    logger.log(chalk.cyan("可清理的 worktree:"));
    for (const { session, reason } of candidates) {
      const size = fs.existsSync(session.worktreePath)
        ? (await $`du -sh ${session.worktreePath}`.text()).split("\t")[0]
        : "N/A";
      logger.log(`  ${chalk.yellow(`${session.type}-${session.number}`)}  ${chalk.dim(reason)}  [${size}]`);
    }
    logger.log("");
  }

  if (options.dryRun) {
    if (!options.silent) logger.info(`共 ${candidates.length} 个可清理（dry-run 模式，未执行）`);
    return;
  }

  // 执行清理
  for (const { session, reason } of candidates) {
    if (!options.silent) logger.info(`清理 ${session.type} #${session.number}（${reason}）`);
    await cleanupIssue(session.number, { reason: "gc", silent: options.silent });
  }

  // 最终 prune
  await $`git worktree prune`.quiet().nothrow();

  if (!options.silent) logger.success(`清理完成，共清理 ${candidates.length} 个 worktree`);
}


// CLI 入口
async function main() {
  const program = new Command();
  program
    .name("worktree-gc")
    .description("批量清理已合并/已关闭的 worktree")
    .option("-n, --dry-run", "仅预览，不执行清理", false)
    .option("-f, --force", "强制清理，跳过运行中进程检查", false)
    .parse();

  const { dryRun, force } = program.opts();

  const gitResult = await checkGitRepo();
  if (!gitResult.success) {
    logger.error(gitResult.error);
    process.exit(1);
  }

  await runGc({ dryRun, force });
}

// 仅在直接执行时运行 CLI，被 import 时跳过
if (import.meta.main) {
  main();
}
