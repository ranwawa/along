#!/usr/bin/env bun
import { $ } from 'bun';
import { consola } from 'consola';
import { check_process_running, checkGitRepo } from '../core/common';
import { readRepoInfo } from '../integration/github-client';

const logger = consola.withTag('worktree-gc');

import fs from 'node:fs';
import chalk from 'chalk';
import { Command } from 'commander';
import { findAllSessions, readSession } from '../core/db';
import { SessionPathManager } from '../core/session-paths';
import { cleanupIssue } from '../domain/cleanup-utils';
import type { GitHubClient } from '../integration/github-client';
import { get_gh_client } from '../integration/github-client';

// session 信息结构
interface GcSessionInfo {
  type: 'issue';
  number: string;
  owner: string;
  repo: string;
  worktreePath: string;
  branchName: string;
  data: any;
}

// GC 判定结果
interface GcCandidate {
  session: GcSessionInfo;
  reason: string;
}

/** 扫描 sessions（从 SQLite 数据库），收集所有 session 信息 */
function scanSessions(): GcSessionInfo[] {
  const allRes = findAllSessions();
  if (!allRes.success) {
    logger.warn(`获取所有 Session 失败: ${allRes.error}`);
    return [];
  }
  const allSessions = allRes.data;
  const results: GcSessionInfo[] = [];

  for (const session of allSessions) {
    const res = readSession(session.owner, session.repo, session.issueNumber);
    if (!res.success || !res.data) continue;
    const data = res.data;

    const paths = new SessionPathManager(
      session.owner,
      session.repo,
      session.issueNumber,
    );
    const worktreePath = paths.getWorktreeDir();
    const branchName = data.context?.branchName || '';

    results.push({
      type: 'issue',
      number: String(session.issueNumber),
      owner: session.owner,
      repo: session.repo,
      worktreePath,
      branchName,
      data,
    });
  }

  return results;
}

/** 检查 session 对应的进程是否仍在运行 */
async function isSessionRunning(session: GcSessionInfo): Promise<boolean> {
  const pid = session.data.pid;
  if (!pid) return false;
  return check_process_running(pid);
}

/** 判断 Issue 类型 session 是否可清理 */
async function checkIssueSession(
  client: GitHubClient,
  session: GcSessionInfo,
): Promise<string | null> {
  // 优先通过分支名查找关联 PR
  if (session.branchName) {
    try {
      const prsRes = await client.listPullRequestsByHead(session.branchName);
      if (prsRes.success && prsRes.data.length > 0) {
        const pr = prsRes.data[0];
        if (pr.merged_at) return `PR #${pr.number} 已合并`;
        if (pr.state === 'closed') return `PR #${pr.number} 已关闭`;
        // PR 仍 open，不清理
        return null;
      }
    } catch (e: any) {
      logger.warn(`查找 Issue #${session.number} 关联 PR 失败: ${e.message}`);
    }
  }

  // 回退：检查 issue 本身状态
  const issueRes = await client.getIssue(session.number);
  if (!issueRes.success) {
    // getIssue 内部已处理 NotFound 映射到 failure，这里简单判断
    if (issueRes.error.includes('Not Found') || issueRes.error.includes('Gone'))
      return `Issue #${session.number} 不存在`;
    logger.warn(`检查 Issue #${session.number} 失败: ${issueRes.error}`);
    return null;
  }

  const issue = issueRes.data;
  if (issue.state === 'closed') return `Issue #${session.number} 已关闭`;
  return null;
}

/** 核心 GC 逻辑（可被 run.ts 导入调用） */
export async function runGc(
  options: { dryRun?: boolean; force?: boolean; silent?: boolean } = {},
) {
  const allSessions = scanSessions();
  if (allSessions.length === 0) {
    if (!options.silent) logger.info('没有活跃的 session');
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
  const sessions =
    currentOwner && currentRepo
      ? allSessions.filter((session) => {
          const belongs =
            session.owner === currentOwner && session.repo === currentRepo;
          if (!belongs && !options.silent) {
            logger.info(
              `跳过 #${session.number}（属于 ${session.owner}/${session.repo}，非当前项目）`,
            );
          }
          return belongs;
        })
      : allSessions;

  if (sessions.length === 0) {
    if (!options.silent) logger.info('当前项目没有需要检查的 session');
    return;
  }

  // 获取 GitHub 客户端
  const clientRes = await get_gh_client();
  if (!clientRes.success) {
    if (!options.silent)
      logger.warn(`无法连接 GitHub API，跳过 GC: ${clientRes.error}`);
    return;
  }
  const client = clientRes.data;

  // 检查每个 session 是否可清理
  const candidates: GcCandidate[] = [];
  for (const session of sessions) {
    // 检查进程是否仍在运行
    if (!options.force && (await isSessionRunning(session))) {
      if (!options.silent)
        logger.info(`跳过 ${session.type} #${session.number}（进程运行中）`);
      continue;
    }

    // worktree 已不存在说明之前已清理过，跳过避免重复处理
    if (!fs.existsSync(session.worktreePath)) {
      if (!options.silent)
        logger.info(`跳过 #${session.number}（worktree 已不存在）`);
      continue;
    }

    const reason = await checkIssueSession(client, session);

    if (reason) {
      candidates.push({ session, reason });
    }
  }

  if (candidates.length === 0) {
    if (!options.silent) logger.info('没有需要清理的 worktree');
    return;
  }

  // 输出候选列表
  if (!options.silent) {
    logger.log('');
    logger.log(chalk.cyan('可清理的 worktree:'));
    for (const { session, reason } of candidates) {
      const size = fs.existsSync(session.worktreePath)
        ? (await $`du -sh ${session.worktreePath}`.text()).split('\t')[0]
        : 'N/A';
      logger.log(
        `  ${chalk.yellow(`${session.type}-${session.number}`)}  ${chalk.dim(reason)}  [${size}]`,
      );
    }
    logger.log('');
  }

  if (options.dryRun) {
    if (!options.silent)
      logger.info(`共 ${candidates.length} 个可清理（dry-run 模式，未执行）`);
    return;
  }

  // 执行清理
  for (const { session, reason } of candidates) {
    if (!options.silent)
      logger.info(`清理 ${session.type} #${session.number}（${reason}）`);
    const cleanRes = await cleanupIssue(
      session.number,
      { reason: 'gc', silent: options.silent },
      session.owner,
      session.repo,
    );
    if (!cleanRes.success && !options.silent) {
      logger.warn(`清理 #${session.number} 失败: ${cleanRes.error}`);
    }
  }

  // 最终 prune
  await $`git worktree prune`.quiet().nothrow();

  if (!options.silent)
    logger.success(`清理完成，共清理 ${candidates.length} 个 worktree`);
}

// CLI 入口
async function main() {
  const program = new Command();
  program
    .name('worktree-gc')
    .description('批量清理已合并/已关闭的 worktree')
    .option('-n, --dry-run', '仅预览，不执行清理', false)
    .option('-f, --force', '强制清理，跳过运行中进程检查', false)
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
