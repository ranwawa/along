/**
 * webhook-handlers.ts - Webhook 事件处理函数
 *
 * 提供三个一次性处理函数，由 webhook-server 直接调用：
 * - reviewPr: PR 新建/更新时，拉 diff 并启动 Reviewer Agent
 * - resolveReview: PR review 提交时，拉评论并启动 Agent 处理
 * - resolveCi: CI 失败时，拉失败信息并启动 Agent 修复
 */

import fs from "fs";
import { consola } from "consola";
import { iso_timestamp } from "../core/common";
import type { Result } from "../core/common";
import { GitHubClient, readGithubToken } from "./github-client";
import type { GitHubReviewComment, GitHubCheckRun } from "./github-client";
import { SessionManager } from "../domain/session-manager";
import { SessionPathManager } from "../core/session-paths";
import { findSessionByPr } from "../core/db";
import { execAgent } from "../domain/issue-agent";
import { withIssueContext } from "../logging/log-router";
import { cleanupIssueAssets } from "../domain/cleanup-utils";
import { STEP, EVENT, PHASE, type SessionContext } from "../domain/session-state-machine";

const logger = consola.withTag("webhook-handlers");

// ─── 并发控制 ──────────────────────────────────────────────

/** 每个 issue 同一时间只允许一个 handler 执行，后续请求排队 */
const issueLocks = new Map<string, Promise<void>>();

function withIssueLock(owner: string, repo: string, issueNumber: number, fn: () => Promise<void>): Promise<void> {
  const key = `${owner}/${repo}#${issueNumber}`;
  const prev = issueLocks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn); // 无论前一个成功或失败，都执行下一个
  issueLocks.set(key, next);
  // 链条结束后清理，避免内存泄漏
  next.finally(() => {
    if (issueLocks.get(key) === next) {
      issueLocks.delete(key);
    }
  });
  return next;
}

// ─── 公共工具（Agent 执行由 issue-agent.ts 提供）────────────

/**
 * 通过 PR 编号反查 issue 编号（从 SQLite 数据库）
 */
function findIssueByPr(owner: string, repo: string, prNumber: number): { issueNumber: number; statusData: any; paths: SessionPathManager } | null {
  const res = findSessionByPr(owner, repo, prNumber);

  if (res.success && res.data) {
    const found = res.data;
    const paths = new SessionPathManager(owner, repo, found.issueNumber);
    return {
      issueNumber: found.issueNumber,
      statusData: found.statusData,
      paths,
    };
  }

  if (!res.success) {
    logger.error(`数据库错误: ${res.error}`);
  }

  return null;
}

// ─── reviewPr ───────────────────────────────────────────────

function writeReviewDiffFile(
  paths: SessionPathManager,
  prNumber: number,
  headSha: string,
  files: any[],
  diff: string,
  repo: { owner: string; name: string },
  session: SessionManager,
): string {
  const filePath = paths.getReviewDiffFile();

  const data = {
    meta: {
      owner: repo.owner,
      repo: repo.name,
      pr_number: prNumber,
      head_sha: headSha,
      fetched_at: iso_timestamp(),
    },
    files: files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      patch: f.patch,
    })),
    diff,
  };

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  session.logEvent("review-diff-written", { prNumber, headSha, fileCount: files.length });
  return filePath;
}

/**
 * PR 新建或有新提交时，拉取 diff 并启动 Reviewer Agent
 */
export function reviewPr(owner: string, repo: string, prNumber: number): Promise<void> {
  const found = findIssueByPr(owner, repo, prNumber);
  if (!found) {
    logger.warn(`未找到 PR #${prNumber} 对应的 issue session，跳过`);
    return Promise.resolve();
  }

  return withIssueLock(owner, repo, found.issueNumber, () => doReviewPr(owner, repo, prNumber));
}

async function doReviewPr(owner: string, repo: string, prNumber: number): Promise<void> {
  logger.info(`开始审查 PR #${prNumber}...`);

  const found = findIssueByPr(owner, repo, prNumber);
  if (!found) return;

  const { issueNumber, statusData, paths } = found;
  await withIssueContext(owner, repo, issueNumber, async () => {

  const tokenRes = await readGithubToken();
  if (!tokenRes.success) {
    logger.error(`GitHub 认证失败: ${tokenRes.error}`);
    return;
  }

  const client = new GitHubClient(tokenRes.data, owner, repo);
  const session = new SessionManager(owner, repo, issueNumber);

  const prRes = await client.getPullRequest(prNumber);
  if (!prRes.success) {
    logger.error(`获取 PR #${prNumber} 失败: ${prRes.error}`);
    return;
  }
  const pr = prRes.data;

  if (pr.state === "closed" || pr.merged) {
    logger.info(`PR #${prNumber} 已${pr.merged ? "合并" : "关闭"}，跳过审查`);
    return;
  }

  const filesRes = await client.getPullRequestFiles(prNumber);
  if (!filesRes.success) {
    logger.error(`获取 PR #${prNumber} 文件列表失败: ${filesRes.error}`);
    return;
  }
  const files = filesRes.data;

  const diffRes = await client.getPullRequestDiff(prNumber);
  if (!diffRes.success) {
    logger.error(`获取 PR #${prNumber} diff 失败: ${diffRes.error}`);
    return;
  }
  const diff = diffRes.data;

  if (files.length === 0) {
    logger.info("PR 无变更文件，跳过审查");
    return;
  }

  const diffFile = writeReviewDiffFile(paths, prNumber, pr.head.sha, files, diff, statusData.repo, session);
  logger.info(`Diff 数据已写入: ${diffFile} (${files.length} 个文件)`);

  session.logEvent("reviewer-agent-launched", { trigger: "webhook", headSha: pr.head.sha, fileCount: files.length });
  const agentRes = await execAgent(statusData.worktreePath, issueNumber, "review-pr-diff", async (pid) => {
    await session.updateStep(statusData.step || STEP.AWAIT_MERGE, undefined, statusData.phase || PHASE.STABILIZATION, undefined, pid);
  });

  if (!agentRes.success) {
    logger.error(`Reviewer Agent 启动失败: ${agentRes.error}`);
    await session.markAsCrashed(agentRes.error);
    return;
  }
  if (agentRes.data.exitCode !== 0) {
    const nativeMsg = agentRes.data.nativeError ? ` [${agentRes.data.nativeError.message}]` : "";
    logger.error(`Reviewer Agent 异常退出 (退出码: ${agentRes.data.exitCode})${nativeMsg}`);
    await session.markAsCrashed(`Reviewer Agent 异常退出 (退出码: ${agentRes.data.exitCode})${nativeMsg}`);
    return;
  }

  session.logEvent("reviewer-agent-completed", { trigger: "webhook" });

  logger.info(`PR #${prNumber} 审查完成`);

  });
}

// ─── resolveReview ──────────────────────────────────────────

function writeCommentsFile(
  paths: SessionPathManager,
  comments: GitHubReviewComment[],
  prNumber: number,
  repo: { owner: string; name: string },
  session: SessionManager,
): string {
  const filePath = paths.getPrCommentsFile();

  let records: any[] = [];
  try {
    if (fs.existsSync(filePath)) {
      const existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      records = existing.records || [];
    }
  } catch {}

  records.push({
    fetched_at: iso_timestamp(),
    comments: comments.map((c) => ({
      id: c.id,
      user: c.user?.login,
      path: c.path,
      line: c.line || c.original_line,
      side: c.side,
      body: c.body,
      diff_hunk: c.diff_hunk,
      created_at: c.created_at,
      in_reply_to_id: c.in_reply_to_id,
    })),
  });

  const data = {
    meta: {
      owner: repo.owner,
      repo: repo.name,
      pr_number: prNumber,
      last_updated: iso_timestamp(),
    },
    records,
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  session.logEvent("pr-comments-written", { prNumber, commentCount: comments.length });
  return filePath;
}

/**
 * PR review 提交时，拉取未解决评论并启动 Agent 处理
 */
export function resolveReview(owner: string, repo: string, prNumber: number): Promise<void> {
  const found = findIssueByPr(owner, repo, prNumber);
  if (!found) {
    logger.warn(`未找到 PR #${prNumber} 对应的 issue session，跳过`);
    return Promise.resolve();
  }

  return withIssueLock(owner, repo, found.issueNumber, () => doResolveReview(owner, repo, prNumber));
}

async function doResolveReview(owner: string, repo: string, prNumber: number): Promise<void> {
  logger.info(`处理 PR #${prNumber} 的 review 评论...`);

  const found = findIssueByPr(owner, repo, prNumber);
  if (!found) return;

  const { issueNumber, statusData, paths } = found;
  await withIssueContext(owner, repo, issueNumber, async () => {

  const tokenRes = await readGithubToken();
  if (!tokenRes.success) {
    logger.error(`GitHub 认证失败: ${tokenRes.error}`);
    return;
  }

  const client = new GitHubClient(tokenRes.data, owner, repo);
  const session = new SessionManager(owner, repo, issueNumber);

  const prRes = await client.getPullRequest(prNumber);
  if (!prRes.success) {
    logger.error(`获取 PR #${prNumber} 失败: ${prRes.error}`);
    return;
  }
  const pr = prRes.data;

  if (pr.state === "closed" || pr.merged) {
    logger.info(`PR #${prNumber} 已${pr.merged ? "合并" : "关闭"}，跳过`);
    return;
  }

  const commentsRes = await client.getReviewComments(prNumber);
  if (!commentsRes.success) {
    logger.error(`获取 PR #${prNumber} 评论失败: ${commentsRes.error}`);
    return;
  }
  const allComments = commentsRes.data;

  const repliedToIds = new Set(
    allComments.filter((c) => c.in_reply_to_id).map((c) => c.in_reply_to_id),
  );
  const unresolvedComments = allComments.filter(
    (c) => !c.in_reply_to_id && !repliedToIds.has(c.id),
  );

  if (unresolvedComments.length === 0) {
    logger.info("没有未解决的评论，跳过");
    return;
  }

  logger.info(`发现 ${unresolvedComments.length} 条未解决的评论`);
  for (const c of unresolvedComments) {
    logger.info(`  - [${c.user?.login}] ${c.path}:${c.line || c.original_line}: ${c.body.slice(0, 80)}`);
  }

  const commentsFile = writeCommentsFile(paths, unresolvedComments, prNumber, statusData.repo, session);
  logger.info(`评论已写入: ${commentsFile}`);

  await session.transition({ type: EVENT.REVIEW_FIX_STARTED, commentCount: unresolvedComments.length });

  session.logEvent("agent-launched", { trigger: "webhook-review", commentCount: unresolvedComments.length });
  const agentRes = await execAgent(statusData.worktreePath, issueNumber, "resolve-pr-review", async (pid) => {
    await session.updateStep(STEP.ADDRESS_REVIEW_FEEDBACK, undefined, PHASE.STABILIZATION, { reviewCommentCount: unresolvedComments.length } as Partial<SessionContext>, pid);
  });

  if (!agentRes.success) {
    logger.error(`Agent 启动失败: ${agentRes.error}`);
    await session.markAsCrashed(agentRes.error);
    return;
  }
  if (agentRes.data.exitCode !== 0) {
    const nativeMsg = agentRes.data.nativeError ? ` [${agentRes.data.nativeError.message}]` : "";
    logger.error(`Agent 异常退出 (退出码: ${agentRes.data.exitCode})${nativeMsg}`);
    await session.markAsCrashed(`Agent 异常退出 (退出码: ${agentRes.data.exitCode})${nativeMsg}`);
    return;
  }

  session.logEvent("agent-completed", { trigger: "webhook-review" });
  await session.transition({ type: "REVIEW_FIX_COMPLETED" });

  logger.info(`PR #${prNumber} 评论处理完成`);

  });
}

// ─── resolveCi ──────────────────────────────────────────────

function writeCiFailureFile(
  paths: SessionPathManager,
  failedRuns: GitHubCheckRun[],
  headSha: string,
  repo: { owner: string; name: string },
  session: SessionManager,
): string {
  const filePath = paths.getCiFailuresFile();

  let records: any[] = [];
  try {
    if (fs.existsSync(filePath)) {
      const existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      records = existing.records || [];
    }
  } catch {}

  records.push({
    head_sha: headSha,
    fetched_at: iso_timestamp(),
    failed_checks: failedRuns.map((r) => ({
      id: r.id,
      name: r.name,
      conclusion: r.conclusion,
      html_url: r.html_url,
      details_url: r.details_url,
      started_at: r.started_at,
      completed_at: r.completed_at,
      output_title: r.output?.title,
      output_summary: r.output?.summary,
    })),
  });

  const data = {
    meta: {
      owner: repo.owner,
      repo: repo.name,
      last_updated: iso_timestamp(),
    },
    records,
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  session.logEvent("ci-failures-written", { headSha, failedCount: failedRuns.length });
  return filePath;
}

/**
 * CI 失败时，拉取失败信息并启动 Agent 修复
 */
export function resolveCi(owner: string, repo: string, prNumber: number): Promise<void> {
  const found = findIssueByPr(owner, repo, prNumber);
  if (!found) {
    logger.warn(`未找到 PR #${prNumber} 对应的 issue session，跳过`);
    return Promise.resolve();
  }

  return withIssueLock(owner, repo, found.issueNumber, () => doResolveCi(owner, repo, prNumber));
}

async function doResolveCi(owner: string, repo: string, prNumber: number): Promise<void> {
  logger.info(`处理 PR #${prNumber} 的 CI 失败...`);

  const found = findIssueByPr(owner, repo, prNumber);
  if (!found) return;

  const { issueNumber, statusData, paths } = found;

  const tokenRes = await readGithubToken();
  if (!tokenRes.success) {
    logger.error(`GitHub 认证失败: ${tokenRes.error}`);
    return;
  }

  const client = new GitHubClient(tokenRes.data, owner, repo);
  const session = new SessionManager(owner, repo, issueNumber);

  const prRes = await client.getPullRequest(prNumber);
  if (!prRes.success) {
    logger.error(`获取 PR #${prNumber} 失败: ${prRes.error}`);
    return;
  }
  const pr = prRes.data;

  if (pr.state === "closed" || pr.merged) {
    logger.info(`PR #${prNumber} 已${pr.merged ? "合并" : "关闭"}，跳过`);
    return;
  }

  const headSha = pr.head.sha;
  const checkRes = await client.getCheckRuns(headSha);
  if (!checkRes.success) {
    logger.error(`获取 headSha ${headSha} 的检查运行失败: ${checkRes.error}`);
    return;
  }
  const checkRuns = checkRes.data;
  const failedRuns = checkRuns.filter(
    (r) => r.conclusion === "failure" || r.conclusion === "timed_out",
  );

  if (failedRuns.length === 0) {
    logger.info("没有失败的 CI 检查，跳过");
    return;
  }

  logger.info(`发现 ${failedRuns.length} 个 CI 检查失败`);
  for (const r of failedRuns) {
    logger.info(`  - ${r.name}: ${r.conclusion} (${r.html_url})`);
  }

  const ciFile = writeCiFailureFile(paths, failedRuns, headSha, statusData.repo, session);
  logger.info(`CI 失败信息已写入: ${ciFile}`);

  await session.transition({ type: EVENT.CI_FIX_STARTED, failedCount: failedRuns.length });
  await session.updateCiResults(0, failedRuns.length, headSha);

  session.logEvent("agent-launched", { trigger: "webhook-ci", failedCount: failedRuns.length, headSha });
  const agentRes = await withIssueContext(owner, repo, issueNumber, () =>
    execAgent(statusData.worktreePath, issueNumber, "resolve-ci-failure", async (pid) => {
      await session.updateStep(STEP.FIX_CI, undefined, PHASE.STABILIZATION, undefined, pid);
    }),
  );

  if (!agentRes.success) {
    logger.error(`Agent 启动失败: ${agentRes.error}`);
    await session.markAsCrashed(agentRes.error);
    return;
  }
  if (agentRes.data.exitCode !== 0) {
    const nativeMsg = agentRes.data.nativeError ? ` [${agentRes.data.nativeError.message}]` : "";
    logger.error(`Agent 异常退出 (退出码: ${agentRes.data.exitCode})${nativeMsg}`);
    await session.markAsCrashed(`Agent 异常退出 (退出码: ${agentRes.data.exitCode})${nativeMsg}`);
    return;
  }

  session.logEvent("agent-completed", { trigger: "webhook-ci" });
  await session.transition({ type: "CI_FIX_COMPLETED" });

  logger.info(`PR #${prNumber} CI 修复完成`);
}

/**
 * 清理 Issue 相关的所有资产（Worktree、本地目录、数据库记录）
 */
export async function cleanupIssueSession(owner: string, repo: string, issueNumber: number, repoPath?: string): Promise<Result<void>> {
  logger.info(`准备清理 Issue #${issueNumber} 的所有资产...`);
  return cleanupIssueAssets(String(issueNumber), { force: true, reason: "webhook-cleanup", silent: true }, owner, repo, repoPath);
}
