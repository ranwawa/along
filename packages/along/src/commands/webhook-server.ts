#!/usr/bin/env bun

// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: legacy webhook server predates current function-size rule.
// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: legacy webhook server predates current file-size rule.
/**
 * webhook-server.ts - 本地 webhook 接收服务器
 *
 * 监听 GitHub App 直接推送的 webhook 事件，自动调用对应的处理函数。
 * 支持 HMAC-SHA256 签名验证确保请求来源可信。
 *
 * 用法：
 *   along webhook-server --port 9876 --secret <your-secret>
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Command } from 'commander';
import { consola } from 'consola';
import { calculate_runtime, check_process_running } from '../core/common';
import { config } from '../core/config';
import { findAllSessions, readSession } from '../core/db';
import { SessionPathManager } from '../core/session-paths';
import { ensureWebhookSecret, ensureWorkspaces } from '../domain/bootstrap';
import { cleanupIssue, cleanupIssueAssets } from '../domain/cleanup-utils';
import { Issue } from '../domain/issue';
import { launchIssueAgent, setDashboardMode } from '../domain/issue-agent';
import { handleTriagedIssue, triageIssue } from '../domain/issue-triage';
import { ensureLabelsExist } from '../domain/label-sync';
import {
  approvePlan,
  ensureOpenDiscussionRound,
  isHumanFeedbackComment,
  mirrorIssueComment,
  parseApprovalCommand,
  recordPlanningAgentComment,
} from '../domain/planning-state';
import {
  generateSessionDiagnostic,
  readSessionDiagnostic,
} from '../domain/session-diagnostics';
import { SessionManager } from '../domain/session-manager';
import {
  COMMAND,
  EVENT,
  isActiveSessionStatus,
  LIFECYCLE,
  PHASE,
  type SessionLifecycle,
  STEP,
} from '../domain/session-state-machine';
import { runTaskDelivery } from '../domain/task-delivery';
import { runTaskImplementationAgent } from '../domain/task-implementation-agent';
import { recoverInterruptedTaskAgentRuns } from '../domain/task-planning';
import { runTaskPlanningAgent } from '../domain/task-planning-agent';
import { runTaskTitleSummary } from '../domain/task-title-summary';
import {
  handleConfigApiRequest,
  isConfigApiPath,
} from '../integration/config-api';
import {
  get_gh_client,
  syncLifecycleLabel,
} from '../integration/github-client';
import {
  handleTaskApiRequest,
  isTaskApiPath,
  type ScheduledTaskDeliveryRun,
  type ScheduledTaskImplementationRun,
  type ScheduledTaskPlanningRun,
  type ScheduledTaskTitleSummaryRun,
} from '../integration/task-api';
import {
  continueAutonomousTaskAfterImplementation,
  continueAutonomousTaskAfterPlanning,
} from '../integration/task-autonomous-continuation';
import {
  cleanupIssueSession,
  resolveCi,
  resolveReview,
  reviewPr,
} from '../integration/webhook-handlers';
import {
  buildRegistry,
  type WorkspaceRegistry,
} from '../integration/workspace-registry';
import { initLogRouter } from '../logging/log-router';
import type { LogCategory, UnifiedLogEntry } from '../logging/log-types';
import {
  getConversationDir,
  getGlobalLogPath as getGlobalLogPathFn,
  getSessionLogPath as getSessionLogPathFn,
  listConversationFiles,
  readConversationFile,
  readGlobalLog as readGlobalLogFn,
  readSessionLog as readSessionLogFn,
} from './log-reader';

const logger = consola.withTag('webhook-server');
const require = createRequire(import.meta.url);

interface BunFile extends Blob {
  exists(): Promise<boolean>;
}

declare const Bun: {
  serve(options: {
    hostname: string;
    port: number;
    fetch(req: Request): Response | Promise<Response>;
  }): unknown;
  file(filePath: string): BunFile;
};

interface GitHubUserPayload {
  login?: string;
  type?: string;
}

interface GitHubIssuePayload {
  number?: number;
  title?: string;
  body?: string;
  labels?: Array<string | { name?: string }>;
}

interface GitHubCommentPayload {
  id?: number;
  body?: string;
  user?: GitHubUserPayload;
  created_at?: string;
}

interface GitHubPullRequestPayload {
  number?: number;
  merged?: boolean;
  body?: string;
}

interface GitHubCheckRunPayload {
  conclusion?: string;
  pull_requests?: Array<{ number?: number }>;
}

interface GitHubWebhookPayload {
  repository?: { full_name?: string };
  action?: string;
  sender?: GitHubUserPayload;
  issue?: GitHubIssuePayload;
  comment?: GitHubCommentPayload;
  pull_request?: GitHubPullRequestPayload;
  check_run?: GitHubCheckRunPayload;
  zen?: string;
}

type DashboardLifecycle = SessionLifecycle | 'zombie';
type UnknownRecord = Record<string, unknown>;

let registry: WorkspaceRegistry;

interface RepositoryOption {
  owner: string;
  repo: string;
  fullName: string;
  path: string;
  isDefault: boolean;
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function listRepositoryOptions(defaultCwd: string): {
  repositories: RepositoryOption[];
  defaultRepository?: string;
} {
  const normalizedDefaultCwd = path.resolve(defaultCwd);
  const repositories = [...registry.listAll()]
    .flatMap(([fullName, localPath]): RepositoryOption[] => {
      const [owner, repo] = fullName.split('/');
      if (!owner || !repo) return [];
      const normalizedLocalPath = path.resolve(localPath);
      return [
        {
          owner,
          repo,
          fullName,
          path: localPath,
          isDefault:
            normalizedLocalPath === normalizedDefaultCwd ||
            normalizedDefaultCwd.startsWith(
              `${normalizedLocalPath}${path.sep}`,
            ),
        },
      ];
    })
    .sort((left, right) => {
      if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
      return left.fullName.localeCompare(right.fullName);
    });

  return {
    repositories,
    defaultRepository: repositories.find((repo) => repo.isDefault)?.fullName,
  };
}

function resolveRepositoryForPath(
  cwd: string,
): { repoOwner: string; repoName: string } | undefined {
  const normalizedCwd = path.resolve(cwd);
  const matches = [...registry.listAll()]
    .flatMap(([fullName, localPath]) => {
      const [owner, repo] = fullName.split('/');
      if (!owner || !repo) return [];
      const normalizedLocalPath = path.resolve(localPath);
      const containsCwd =
        normalizedLocalPath === normalizedCwd ||
        normalizedCwd.startsWith(`${normalizedLocalPath}${path.sep}`);
      return containsCwd
        ? [{ owner, repo, pathLength: normalizedLocalPath.length }]
        : [];
    })
    .sort((left, right) => right.pathLength - left.pathLength);

  const match = matches[0];
  return match ? { repoOwner: match.owner, repoName: match.repo } : undefined;
}

function parseIssueLabels(
  labels: GitHubIssuePayload['labels'] | undefined,
): string[] {
  if (!Array.isArray(labels)) return [];
  return labels.flatMap((label) => {
    if (typeof label === 'string') return [label];
    return label.name ? [label.name] : [];
  });
}

function isLogCategory(value: string): value is LogCategory {
  return (
    value === 'lifecycle' ||
    value === 'conversation' ||
    value === 'diagnostic' ||
    value === 'webhook' ||
    value === 'server'
  );
}

function isLogLevel(value: string): value is UnifiedLogEntry['level'] {
  return (
    value === 'info' ||
    value === 'warn' ||
    value === 'error' ||
    value === 'success'
  );
}

function parseLogCategories(value: string | null): LogCategory[] | undefined {
  const items = value?.split(',').filter(isLogCategory);
  return items && items.length > 0 ? items : undefined;
}

function parseLogLevels(
  value: string | null,
): UnifiedLogEntry['level'][] | undefined {
  const items = value?.split(',').filter(isLogLevel);
  return items && items.length > 0 ? items : undefined;
}

function resolveWebDistDir(): string {
  try {
    const packageJsonPath = require.resolve('@ranwawa/along-web/package.json');
    return path.join(path.dirname(packageJsonPath), 'dist');
  } catch {
    return path.resolve(import.meta.dir, '..', '..', '..', 'along-web', 'dist');
  }
}

function createLogSSEResponse(logPath: string, req: Request): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        let lastSize = 0;
        try {
          if (fs.existsSync(logPath)) {
            lastSize = fs.statSync(logPath).size;
          }
        } catch {}

        const id = setInterval(() => {
          try {
            if (!fs.existsSync(logPath)) return;
            const stat = fs.statSync(logPath);
            if (stat.size <= lastSize) return;

            const fd = fs.openSync(logPath, 'r');
            const buf = Buffer.alloc(stat.size - lastSize);
            fs.readSync(fd, buf, 0, buf.length, lastSize);
            fs.closeSync(fd);
            lastSize = stat.size;

            const newLines = buf
              .toString('utf-8')
              .trim()
              .split('\n')
              .filter(Boolean);
            const entries = newLines
              .map((l) => {
                try {
                  return JSON.parse(l);
                } catch {
                  return null;
                }
              })
              .filter(Boolean);
            if (entries.length > 0) {
              controller.enqueue(`data: ${JSON.stringify(entries)}\n\n`);
            }
          } catch {}
        }, 1000);

        req.signal.addEventListener('abort', () => {
          clearInterval(id);
        });
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}

// ── Agent 并发限制（防止同时启动过多 agent 耗尽资源） ──
const MAX_CONCURRENT_AGENTS = parseInt(
  process.env.ALONG_MAX_CONCURRENT_AGENTS || '3',
  10,
);
let runningAgents = 0;
const agentQueue: Array<{ fn: () => Promise<unknown>; label: string }> = [];

function enqueueAgent(label: string, fn: () => Promise<unknown>) {
  if (runningAgents < MAX_CONCURRENT_AGENTS) {
    runAgent(label, fn);
  } else {
    logger.info(
      `[并发限制] ${label} 已排队（当前 ${runningAgents}/${MAX_CONCURRENT_AGENTS} 运行中，队列 ${agentQueue.length} 个）`,
    );
    agentQueue.push({ fn, label });
  }
}

function runAgent(label: string, fn: () => Promise<unknown>) {
  runningAgents++;
  logger.info(
    `[并发限制] ${label} 开始执行（${runningAgents}/${MAX_CONCURRENT_AGENTS}）`,
  );
  fn()
    .catch((err) => {
      logger.error(`[并发限制] ${label} 执行异常: ${err.message}`);
    })
    .finally(() => {
      runningAgents--;
      logger.info(
        `[并发限制] ${label} 执行完毕（${runningAgents}/${MAX_CONCURRENT_AGENTS}，队列 ${agentQueue.length} 个）`,
      );
      // 从队列中取出下一个任务
      const next = agentQueue.shift();
      if (next) {
        runAgent(next.label, next.fn);
      }
    });
}

// ── Webhook 事件去重（防止 GitHub 超时重发） ──
const DEDUP_MAX_SIZE = 1000;
const processedDeliveries = new Set<string>();
const issueCommentLocks = new Map<string, Promise<unknown>>();
const taskPlanningLocks = new Map<string, Promise<void>>();

// ── Dashboard 兜底同步节流（防止频繁调用 GitHub API） ──
const FALLBACK_SYNC_INTERVAL_MS = 60_000;
let lastFallbackSyncTime = 0;

function isDuplicateDelivery(deliveryId: string): boolean {
  if (!deliveryId || deliveryId === '-') return false;
  if (processedDeliveries.has(deliveryId)) return true;
  processedDeliveries.add(deliveryId);
  // 超过上限时清理最早的条目
  if (processedDeliveries.size > DEDUP_MAX_SIZE) {
    const first = processedDeliveries.values().next().value;
    if (first) processedDeliveries.delete(first);
  }
  return false;
}

function withIssueCommentLock<T>(
  owner: string,
  repo: string,
  issueNumber: number,
  fn: () => Promise<T>,
): Promise<T> {
  const key = `${owner}/${repo}#${issueNumber}`;
  const previous = issueCommentLocks.get(key) || Promise.resolve();
  const next = previous.then(fn, fn);
  issueCommentLocks.set(key, next);
  next.finally(() => {
    if (issueCommentLocks.get(key) === next) {
      issueCommentLocks.delete(key);
    }
  });
  return next;
}

function withTaskPlanningLock(
  taskId: string,
  fn: () => Promise<void>,
): Promise<void> {
  const previous = taskPlanningLocks.get(taskId) || Promise.resolve();
  const next = previous.then(fn, fn);
  taskPlanningLocks.set(taskId, next);
  next.finally(() => {
    if (taskPlanningLocks.get(taskId) === next) {
      taskPlanningLocks.delete(taskId);
    }
  });
  return next;
}

function enqueueTaskPlanningRun(input: ScheduledTaskPlanningRun) {
  enqueueAgent(`Task ${input.taskId} planning`, async () => {
    await withTaskPlanningLock(input.taskId, async () => {
      logger.info(`[Task ${input.taskId}] planning 开始: ${input.reason}`);
      const result = await runTaskPlanningAgent({
        taskId: input.taskId,
        agentId: input.agentId,
        cwd: input.cwd,
        editor: input.editor,
        model: input.model,
        personalityVersion: input.personalityVersion,
      });
      if (!result.success) {
        logger.error(`[Task ${input.taskId}] planning 失败: ${result.error}`);
        return;
      }
      logger.info(
        `[Task ${input.taskId}] planning 完成: ${result.data.action}`,
      );
      const continuation = continueAutonomousTaskAfterPlanning({
        taskId: input.taskId,
        cwd: input.cwd,
        plannerAction: result.data.action,
        scheduleImplementation: enqueueTaskImplementationRun,
      });
      if (!continuation.success) {
        logger.error(
          `[Task ${input.taskId}] autonomous planning 推进失败: ${continuation.error}`,
        );
      } else if (continuation.data !== 'skipped') {
        logger.info(
          `[Task ${input.taskId}] autonomous planning 推进: ${continuation.data}`,
        );
      }
    });
  });
}

function enqueueTaskImplementationRun(input: ScheduledTaskImplementationRun) {
  enqueueAgent(`Task ${input.taskId} implementation`, async () => {
    await withTaskPlanningLock(input.taskId, async () => {
      logger.info(
        `[Task ${input.taskId}] implementation 开始: ${input.reason}`,
      );
      const result = await runTaskImplementationAgent({
        taskId: input.taskId,
        agentId: input.agentId,
        cwd: input.cwd,
        editor: input.editor,
        model: input.model,
        personalityVersion: input.personalityVersion,
      });
      if (!result.success) {
        logger.error(
          `[Task ${input.taskId}] implementation 失败: ${result.error}`,
        );
        return;
      }
      logger.info(`[Task ${input.taskId}] implementation 完成`);
      const continuation = continueAutonomousTaskAfterImplementation({
        taskId: input.taskId,
        cwd: input.cwd,
        scheduleImplementation: enqueueTaskImplementationRun,
        scheduleDelivery: enqueueTaskDeliveryRun,
      });
      if (!continuation.success) {
        logger.error(
          `[Task ${input.taskId}] autonomous implementation 推进失败: ${continuation.error}`,
        );
      } else if (continuation.data !== 'skipped') {
        logger.info(
          `[Task ${input.taskId}] autonomous implementation 推进: ${continuation.data}`,
        );
      }
    });
  });
}

function enqueueTaskDeliveryRun(input: ScheduledTaskDeliveryRun) {
  enqueueAgent(`Task ${input.taskId} delivery`, async () => {
    await withTaskPlanningLock(input.taskId, async () => {
      logger.info(`[Task ${input.taskId}] delivery 开始: ${input.reason}`);
      const result = await runTaskDelivery({
        taskId: input.taskId,
        cwd: input.cwd,
      });
      if (!result.success) {
        logger.error(`[Task ${input.taskId}] delivery 失败: ${result.error}`);
        return;
      }
      logger.info(`[Task ${input.taskId}] delivery 完成: ${result.data.prUrl}`);
    });
  });
}

function runScheduledTaskTitleSummary(input: ScheduledTaskTitleSummaryRun) {
  void runTaskTitleSummary(input)
    .then((result) => {
      if (!result.success) {
        logger.warn(`[Task ${input.taskId}] 标题自动总结失败: ${result.error}`);
      }
    })
    .catch((error: unknown) => {
      logger.error(
        `[Task ${input.taskId}] 标题自动总结异常: ${getErrorMessage(error)}`,
      );
    });
}

/**
 * 验证 GitHub webhook HMAC-SHA256 签名
 */
function verifySignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!secret) return true;
  if (!signature || signature === 'none') return false;

  const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

/**
 * 解析仓库信息
 */
function parseRepository(
  fullName: string,
): { owner: string; repo: string } | null {
  const parts = fullName.split('/');
  if (parts.length !== 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

/**
 * 异步执行处理函数（fire-and-forget，不阻塞 HTTP 响应）
 */
function fireAndForget(fn: () => Promise<unknown>) {
  fn().catch((err) => {
    logger.error(`处理函数执行内部异常: ${err.message}`);
  });
}

function getSessionQuery(
  url: URL,
): { owner: string; repo: string; issueNumber: number } | null {
  const owner = url.searchParams.get('owner') || '';
  const repo = url.searchParams.get('repo') || '';
  const issueNumber = Number(url.searchParams.get('issueNumber') || '');
  if (!owner || !repo || !issueNumber) return null;
  return { owner, repo, issueNumber };
}

/**
 * 处理 GitHub webhook 事件
 */
async function handleEvent(
  eventType: string,
  payload: GitHubWebhookPayload,
  deliveryId: string,
): Promise<{ status: number; message: string }> {
  const repoFullName = payload.repository?.full_name;
  if (!repoFullName) {
    return { status: 400, message: '缺少 repository 信息' };
  }

  const repoInfo = parseRepository(repoFullName);
  if (!repoInfo) {
    return { status: 400, message: `无效的仓库格式: ${repoFullName}` };
  }

  const { owner, repo } = repoInfo;

  // 自动确保 label 已同步（幂等，带内存缓存）
  const clientRes = await get_gh_client(owner, repo);
  if (clientRes.success) {
    const ensureRes = await ensureLabelsExist(clientRes.data);
    if (!ensureRes.success) {
      logger.warn(`Label 同步失败: ${ensureRes.error}`);
    }
  }

  const repoPath = registry.resolve(owner, repo);
  if (!repoPath) {
    logger.warn(`仓库 ${repoFullName} 未在本地工作区中注册，跳过`);
    return { status: 200, message: `仓库 ${repoFullName} 未注册，跳过` };
  }

  const action = payload.action || '';
  logger.info(
    `[${deliveryId}] 收到事件: ${eventType}.${action} | 仓库: ${repoFullName}`,
  );

  switch (eventType) {
    case 'issues': {
      const issueNumber = payload.issue?.number;
      if (!issueNumber) return { status: 400, message: '缺少 issue number' };

      if (action === 'opened') {
        if (payload.sender?.type === 'Bot') {
          return { status: 200, message: '忽略 Bot 创建的 Issue' };
        }

        const issueTitle = payload.issue?.title || '';
        const issueBody = payload.issue?.body || '';
        const issueLabels = parseIssueLabels(payload.issue?.labels);

        logger.info(`Issue #${issueNumber} 已创建，开始分类...`);
        enqueueAgent(`Issue #${issueNumber} 分类+处理`, async () => {
          const triageRes = await triageIssue(
            issueTitle,
            issueBody,
            issueLabels,
          );
          if (!triageRes.success) {
            logger.error(
              `Issue #${issueNumber} 分类失败，终止处理: ${triageRes.error}`,
            );
            return;
          }

          const triageResult = triageRes.data;
          logger.info(
            `Issue #${issueNumber} 分类结果: ${triageResult.classification} (${triageResult.reason})`,
          );
          const handleRes = await handleTriagedIssue(
            owner,
            repo,
            issueNumber,
            triageResult,
            { repoPath },
          );
          if (!handleRes.success) {
            logger.error(`处理分类结果失败: ${handleRes.error}`);
          }
        });
        return { status: 202, message: `已触发 Issue #${issueNumber} 分类` };
      }

      if (action === 'deleted') {
        logger.info(`收到 Issue #${issueNumber} 删除事件，启动资产清理...`);
        fireAndForget(async () => {
          const res = await cleanupIssueSession(
            owner,
            repo,
            issueNumber,
            repoPath,
          );
          if (!res.success) {
            logger.error(`Issue #${issueNumber} 资产清理失败: ${res.error}`);
          }
        });
        return {
          status: 202,
          message: `已触发 Issue #${issueNumber} 资产清理`,
        };
      }

      if (action === 'closed') {
        logger.info(`Issue #${issueNumber} 已关闭，检查关联 session...`);
        fireAndForget(async () => {
          const session = new SessionManager(owner, repo, issueNumber);
          const statusRes = session.readStatus();
          if (!statusRes.success || !statusRes.data) return;

          const { lifecycle } = statusRes.data;
          if (
            lifecycle === LIFECYCLE.COMPLETED ||
            lifecycle === LIFECYCLE.FAILED
          )
            return;

          await session.transition({ type: EVENT.ISSUE_CLOSED });
          await syncLifecycleLabel(
            owner,
            repo,
            issueNumber,
            LIFECYCLE.COMPLETED,
          );

          logger.info(`Issue #${issueNumber} 关闭，开始清理本地资源...`);
          const cleanRes = await cleanupIssue(
            String(issueNumber),
            { reason: 'issue-closed', silent: false },
            owner,
            repo,
            repoPath,
          );
          if (!cleanRes.success) {
            logger.warn(`清理 Issue #${issueNumber} 失败: ${cleanRes.error}`);
          }
        });
        return {
          status: 202,
          message: `已触发 Issue #${issueNumber} 关闭处理`,
        };
      }

      return { status: 200, message: `忽略 issues.${action} 事件` };
    }

    case 'issue_comment': {
      if (action !== 'created')
        return { status: 200, message: `忽略 issue_comment.${action} 事件` };

      const issueNumber = payload.issue?.number;
      if (!issueNumber) return { status: 400, message: '缺少 issue number' };

      return withIssueCommentLock(owner, repo, issueNumber, async () => {
        const body = (payload.comment?.body || '').trim();
        const command = body.split(/\s/)[0]?.toLowerCase();
        const commentId = Number(payload.comment?.id || 0);
        const commentUser: GitHubUserPayload =
          payload.comment?.user || payload.sender || {};
        const mirrorRes = mirrorIssueComment({
          owner,
          repo,
          issueNumber,
          commentId,
          authorLogin: commentUser.login || 'unknown',
          senderType: commentUser.type,
          body,
          createdAt: payload.comment?.created_at,
        });
        if (!mirrorRes.success) {
          logger.error(`镜像 Issue 评论失败: ${mirrorRes.error}`);
          return { status: 500, message: mirrorRes.error };
        }

        const planningCommentRes = recordPlanningAgentComment({
          owner,
          repo,
          issueNumber,
          commentId,
          body,
          createdAt: payload.comment?.created_at,
        });
        if (!planningCommentRes.success) {
          logger.error(
            `记录 planning comment 失败: ${planningCommentRes.error}`,
          );
          return { status: 500, message: planningCommentRes.error };
        }

        const issueLabels = parseIssueLabels(payload.issue?.labels);
        const isActionableIssue = issueLabels.some(
          (label) => label === 'bug' || label === 'feature',
        );
        const session = new SessionManager(owner, repo, issueNumber);
        const sessionRes = session.readStatus();
        const sessionStatus = sessionRes.success ? sessionRes.data : null;

        logger.info(
          `[${deliveryId}] Issue #${issueNumber} 评论决策上下文: labels=[${issueLabels.join(',')}] isActionable=${isActionableIssue} session=${sessionStatus ? `phase=${sessionStatus.phase},lifecycle=${sessionStatus.lifecycle}` : '无'} command=${command} author=${commentUser.login}(${commentUser.type})`,
        );

        if (command === COMMAND.APPROVE) {
          if (!isActionableIssue) {
            return {
              status: 200,
              message: '非 bug/feature issue，忽略 /approve 指令',
            };
          }

          if (sessionStatus?.phase !== PHASE.PLANNING) {
            return {
              status: 200,
              message: '当前不在 planning 阶段，忽略 /approve',
            };
          }

          const target = parseApprovalCommand(body);
          if (!target) {
            return {
              status: 200,
              message:
                '无法解析 /approve 指令，请使用 /approve、/approve vN 或 /approve plan:<id>',
            };
          }

          const approveRes = approvePlan(
            owner,
            repo,
            issueNumber,
            target,
            commentId,
          );
          if (!approveRes.success) {
            logger.warn(
              `Issue #${issueNumber} /approve 未通过: ${approveRes.error}`,
            );
            return {
              status: 200,
              message: `审批未通过: ${approveRes.error}`,
            };
          }

          logger.info(
            `Issue #${issueNumber} 收到有效 /approve，批准 Plan v${approveRes.data.version} 并触发实现阶段`,
          );
          await session.transition({ type: EVENT.APPROVED });

          enqueueAgent(`Issue #${issueNumber} 实现`, async () => {
            const res = await launchIssueAgent(
              owner,
              repo,
              issueNumber,
              'implementation',
              {
                taskData: { title: `Issue #${issueNumber}` },
                repoPath,
              },
            );
            if (!res.success) logger.error(`启动实现阶段失败: ${res.error}`);
          });
          return {
            status: 202,
            message: `已批准当前正式计划并触发实现阶段: Issue #${issueNumber}`,
          };
        }

        if (command === COMMAND.REJECT) {
          logger.info(`Issue #${issueNumber} 收到 /reject 指令`);
          await session.transition({
            type: EVENT.MANUAL_STATUS_UPDATE,
            lifecycle: LIFECYCLE.FAILED,
            message: '方案被拒绝',
          });
          return {
            status: 200,
            message: `Issue #${issueNumber} 已标记为 failed`,
          };
        }

        const isHumanFeedback = isHumanFeedbackComment(mirrorRes.data);
        if (
          isActionableIssue &&
          sessionStatus?.phase === PHASE.PLANNING &&
          isHumanFeedback
        ) {
          const roundRes = ensureOpenDiscussionRound(owner, repo, issueNumber);
          if (!roundRes.success) {
            logger.error(`创建/读取 discussion round 失败: ${roundRes.error}`);
            return { status: 500, message: roundRes.error };
          }

          if (sessionStatus.lifecycle !== LIFECYCLE.RUNNING && roundRes.data) {
            logger.info(
              `Issue #${issueNumber} 收到 planning 反馈，启动新一轮讨论处理`,
            );
            enqueueAgent(`Issue #${issueNumber} planning round`, async () => {
              const res = await launchIssueAgent(
                owner,
                repo,
                issueNumber,
                'planning',
                {
                  trigger: 'planning-feedback',
                  taskData: { title: `Issue #${issueNumber}` },
                  repoPath,
                },
              );
              if (!res.success)
                logger.error(`启动 planning round 失败: ${res.error}`);
            });
            return {
              status: 202,
              message: `已触发 planning round: Issue #${issueNumber}`,
            };
          }

          return {
            status: 200,
            message:
              sessionStatus.lifecycle === LIFECYCLE.RUNNING
                ? '已记录 planning 反馈，等待当前 Agent 处理完成后继续'
                : '已记录 planning 反馈',
          };
        } else {
          const reasons = [];
          if (!isActionableIssue) reasons.push('缺少 bug/feature label');
          if (!sessionStatus) reasons.push('无 session');
          else if (sessionStatus.phase !== PHASE.PLANNING)
            reasons.push(`phase=${sessionStatus.phase}(非 planning)`);
          if (!isHumanFeedback) reasons.push('非人类反馈评论');
          logger.debug(
            `Issue #${issueNumber} 未进入 planning 反馈处理: ${reasons.join(', ')}`,
          );
        }

        if (planningCommentRes.data !== 'ignored') {
          return {
            status: 200,
            message:
              planningCommentRes.data === 'plan'
                ? '已记录官方计划评论'
                : '已记录 planning update 评论',
          };
        }

        return { status: 200, message: '已镜像评论，无需进一步处理' };
      });
    }

    case 'pull_request': {
      const prNumber = payload.pull_request?.number;
      if (!prNumber) return { status: 400, message: '缺少 PR number' };

      if (action === 'opened' || action === 'synchronize') {
        logger.info(`PR #${prNumber} 事件: ${action}，启动代码审查...`);
        fireAndForget(async () => {
          await reviewPr(owner, repo, prNumber);
        });
        return { status: 202, message: `已触发代码审查 PR #${prNumber}` };
      }

      if (action === 'closed' && payload.pull_request?.merged) {
        const body = payload.pull_request?.body || '';
        const issueMatch = body.match(/(?:fixes|closes|resolves)\s+#(\d+)/i);
        if (issueMatch) {
          const linkedIssue = Number(issueMatch[1]);
          logger.info(`PR #${prNumber} 已合并，处理 Issue #${linkedIssue}...`);
          fireAndForget(async () => {
            const session = new SessionManager(owner, repo, linkedIssue);
            await session.transition({ type: EVENT.PR_MERGED });
            await syncLifecycleLabel(
              owner,
              repo,
              linkedIssue,
              LIFECYCLE.COMPLETED,
            );

            logger.info(
              `PR #${prNumber} 已合并，开始清理 Issue #${linkedIssue} 的本地资源...`,
            );
            const cleanRes = await cleanupIssue(
              String(linkedIssue),
              { reason: 'pr-merged', silent: false },
              owner,
              repo,
              repoPath,
            );
            if (!cleanRes.success) {
              logger.warn(`清理 Issue #${linkedIssue} 失败: ${cleanRes.error}`);
            }
          });
          return {
            status: 202,
            message: `已触发资产回收: Issue #${linkedIssue}`,
          };
        }
        return { status: 200, message: 'PR 已合并但未关联 issue' };
      }

      if (action === 'closed' && !payload.pull_request?.merged) {
        const body = payload.pull_request?.body || '';
        const issueMatch = body.match(/(?:fixes|closes|resolves)\s+#(\d+)/i);
        if (issueMatch) {
          const linkedIssue = Number(issueMatch[1]);
          logger.info(
            `PR #${prNumber} 被关闭但未合并，处理 Issue #${linkedIssue}...`,
          );
          fireAndForget(async () => {
            const session = new SessionManager(owner, repo, linkedIssue);
            const statusRes = session.readStatus();
            if (!statusRes.success || !statusRes.data) return;

            const { lifecycle } = statusRes.data;
            if (
              lifecycle === LIFECYCLE.COMPLETED ||
              lifecycle === LIFECYCLE.FAILED
            )
              return;

            await session.transition({
              type: EVENT.PR_REJECTED,
              message: `PR #${prNumber} 被关闭但未合并`,
            });
            await syncLifecycleLabel(
              owner,
              repo,
              linkedIssue,
              LIFECYCLE.FAILED,
            );
          });
          return {
            status: 202,
            message: `PR #${prNumber} 被拒绝，已触发 Issue #${linkedIssue} 状态更新`,
          };
        }
        return { status: 200, message: 'PR 被关闭但未关联 issue' };
      }

      return { status: 200, message: `忽略 pull_request.${action} 事件` };
    }

    case 'pull_request_review': {
      const prNumber = payload.pull_request?.number;
      if (!prNumber) return { status: 400, message: '缺少 PR number' };

      if (action === 'submitted') {
        logger.info(`PR #${prNumber} 收到 review，启动评论处理...`);
        enqueueAgent(`PR #${prNumber} review 处理`, async () => {
          await resolveReview(owner, repo, prNumber);
        });
        return { status: 202, message: `已触发评论处理 PR #${prNumber}` };
      }

      return {
        status: 200,
        message: `忽略 pull_request_review.${action} 事件`,
      };
    }

    case 'check_run': {
      if (action !== 'completed') {
        return { status: 200, message: `忽略 check_run.${action} 事件` };
      }
      const conclusion = payload.check_run?.conclusion;
      if (conclusion !== 'failure' && conclusion !== 'timed_out') {
        return { status: 200, message: 'CI 未失败，跳过' };
      }
      const pullRequests = payload.check_run?.pull_requests || [];
      if (pullRequests.length === 0) {
        return { status: 200, message: 'check_run 未关联 PR，跳过' };
      }
      const prNumber = pullRequests[0].number;
      logger.info(`PR #${prNumber} CI 失败，启动修复...`);
      enqueueAgent(`PR #${prNumber} CI 修复`, async () => {
        await resolveCi(owner, repo, prNumber);
      });
      return { status: 202, message: `已触发 CI 修复 PR #${prNumber}` };
    }

    default:
      return { status: 200, message: `忽略事件: ${eventType}` };
  }
}

async function main() {
  const program = new Command()
    .name('along webhook-server')
    .description('启动本地 webhook 接收服务器，监听 GitHub App webhook 事件')
    .option('--port <port>', '监听端口', '9876')
    .option(
      '--secret <secret>',
      'Webhook 签名密钥（GitHub App 的 webhook secret）',
    )
    .option('--host <host>', '监听地址', '0.0.0.0')
    .option('--no-dashboard', '禁用终端 Dashboard，使用原始日志模式')
    .parse(process.argv);

  const opts = program.opts();
  const port = parseInt(opts.port, 10);
  const host = opts.host;
  const useDashboard = opts.dashboard !== false;

  const secretRes = await ensureWebhookSecret(opts);
  if (!secretRes.success) {
    process.exit(1);
  }
  const secret = secretRes.data;

  const workspacesRes = await ensureWorkspaces();
  if (!workspacesRes.success) {
    process.exit(1);
  }

  const registryRes = await buildRegistry(workspacesRes.data);
  if (!registryRes.success) {
    logger.error(`工作区扫描失败: ${registryRes.error}`);
    process.exit(1);
  }
  registry = registryRes.data;
  logger.info(`已注册 ${registry.listAll().size} 个仓库`);
  for (const [key, localPath] of registry.listAll()) {
    logger.info(`  ${key} → ${localPath}`);
  }

  if (useDashboard) {
    initLogRouter();
  }

  const recoveredRunsRes = recoverInterruptedTaskAgentRuns(
    'Webhook server 启动时发现上次 Agent run 未正常结束，已标记为失败。',
  );
  if (!recoveredRunsRes.success) {
    logger.warn(`恢复中断的 Task Agent Run 失败: ${recoveredRunsRes.error}`);
  } else if (recoveredRunsRes.data.recoveredRuns.length > 0) {
    logger.warn(
      `已恢复 ${recoveredRunsRes.data.recoveredRuns.length} 个中断的 Task Agent Run` +
        (recoveredRunsRes.data.resetTaskIds.length > 0
          ? `，重置 ${recoveredRunsRes.data.resetTaskIds.length} 个 Task 状态`
          : ''),
    );
  }

  const _server = Bun.serve({
    hostname: host,
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // 健康检查
      if (url.pathname === '/health') {
        return new Response(
          JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
          {
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      // Webhook 端点
      if (url.pathname === '/webhook' && req.method === 'POST') {
        const body = await req.text();

        // 验证签名
        if (secret) {
          const signature = req.headers.get('X-Hub-Signature-256') || '';
          if (!verifySignature(body, signature, secret)) {
            logger.error('签名验证失败');
            return new Response(JSON.stringify({ error: '签名验证失败' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }

        let payload: GitHubWebhookPayload;
        try {
          const parsed = JSON.parse(body) as unknown;
          if (!isRecord(parsed)) {
            return new Response(JSON.stringify({ error: '无效的 JSON' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          payload = parsed as GitHubWebhookPayload;
        } catch {
          return new Response(JSON.stringify({ error: '无效的 JSON' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const githubEvent = req.headers.get('X-GitHub-Event') || '';
        const deliveryId = req.headers.get('X-GitHub-Delivery') || '-';

        // 事件去重：防止 GitHub 超时重发导致重复处理
        if (isDuplicateDelivery(deliveryId)) {
          logger.debug(`[${deliveryId}] 重复事件，跳过`);
          return new Response(JSON.stringify({ message: '重复事件，已忽略' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // 处理 ping 事件（GitHub App 安装/配置时发送）
        if (githubEvent === 'ping') {
          logger.success(
            `[${deliveryId}] 收到 GitHub ping 事件，zen: ${payload.zen}`,
          );
          return new Response(JSON.stringify({ message: 'pong' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (!githubEvent) {
          return new Response(
            JSON.stringify({ error: '缺少 X-GitHub-Event header' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        const result = await handleEvent(githubEvent, payload, deliveryId);
        return new Response(JSON.stringify({ message: result.message }), {
          status: result.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // ── CORS preflight ──
      if (req.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      }

      // ── API: /api/tasks ──
      if (isTaskApiPath(url.pathname)) {
        return handleTaskApiRequest(req, url, {
          defaultCwd: process.cwd(),
          resolveRepoPath: (owner, repo) => registry.resolve(owner, repo),
          resolveRepositoryForPath,
          schedulePlanner: enqueueTaskPlanningRun,
          scheduleImplementation: enqueueTaskImplementationRun,
          scheduleDelivery: enqueueTaskDeliveryRun,
          scheduleTitleSummary: runScheduledTaskTitleSummary,
        });
      }

      // ── API: /api/config ──
      if (isConfigApiPath(url.pathname)) {
        return handleConfigApiRequest(req);
      }

      // ── API: /api/repositories ──
      if (url.pathname === '/api/repositories' && req.method === 'GET') {
        return createJsonResponse(listRepositoryOptions(process.cwd()));
      }

      // ── API: /api/sessions ──
      if (url.pathname === '/api/sessions' && req.method === 'GET') {
        const allRes = findAllSessions();
        if (!allRes.success) {
          return new Response(
            JSON.stringify({ error: 'Failed to load sessions' }),
            { status: 500 },
          );
        }
        const sessions = [];
        for (const info of allRes.data) {
          const res = readSession(info.owner, info.repo, info.issueNumber);
          if (res.success && res.data) {
            let displayLifecycle: DashboardLifecycle = res.data.lifecycle;
            if (isActiveSessionStatus(displayLifecycle) && res.data.pid) {
              const alive = await check_process_running(res.data.pid);
              if (!alive) displayLifecycle = 'zombie';
            }
            sessions.push({
              ...res.data,
              lifecycle: displayLifecycle,
              owner: info.owner,
              repo: info.repo,
              runtime: calculate_runtime(res.data.startTime),
              hasWorktree: res.data.worktreePath
                ? fs.existsSync(res.data.worktreePath)
                : false,
            });
          }
        }

        // 兜底同步：对 await_merge 状态的 session 检查 GitHub 实际状态
        const now = Date.now();
        if (now - lastFallbackSyncTime >= FALLBACK_SYNC_INTERVAL_MS) {
          lastFallbackSyncTime = now;
          const staleAwaitMerge = sessions.filter(
            (s) =>
              s.lifecycle === LIFECYCLE.WAITING_EXTERNAL &&
              s.step === STEP.AWAIT_MERGE,
          );
          if (staleAwaitMerge.length > 0) {
            fireAndForget(async () => {
              for (const s of staleAwaitMerge) {
                try {
                  const sRepoPath = registry.resolve(s.owner, s.repo);
                  const clientRes = await get_gh_client(s.owner, s.repo);
                  if (!clientRes.success) continue;
                  const client = clientRes.data;

                  const prNumber = s.context?.prNumber;
                  if (prNumber) {
                    const prRes = await client.getPullRequest(prNumber);
                    if (!prRes.success) continue;
                    const pr = prRes.data;

                    const session = new SessionManager(
                      s.owner,
                      s.repo,
                      s.issueNumber,
                    );
                    if (pr.merged) {
                      logger.info(
                        `[兜底同步] PR #${prNumber} 已合并，同步 Issue #${s.issueNumber} 状态`,
                      );
                      await session.transition({ type: EVENT.PR_MERGED });
                      await syncLifecycleLabel(
                        s.owner,
                        s.repo,
                        s.issueNumber,
                        LIFECYCLE.COMPLETED,
                      );
                      const cleanRes = await cleanupIssue(
                        String(s.issueNumber),
                        { reason: 'fallback-sync', silent: true },
                        s.owner,
                        s.repo,
                        sRepoPath,
                      );
                      if (!cleanRes.success) {
                        logger.warn(
                          `[兜底同步] 清理 Issue #${s.issueNumber} 失败: ${cleanRes.error}`,
                        );
                      }
                    } else if (pr.state === 'closed') {
                      logger.info(
                        `[兜底同步] PR #${prNumber} 已关闭未合并，同步 Issue #${s.issueNumber} 状态`,
                      );
                      await session.transition({
                        type: EVENT.PR_REJECTED,
                        message: `PR #${prNumber} 被关闭但未合并（兜底同步）`,
                      });
                      await syncLifecycleLabel(
                        s.owner,
                        s.repo,
                        s.issueNumber,
                        LIFECYCLE.FAILED,
                      );
                    }
                    continue;
                  }

                  const issueRes = await client.getIssue(s.issueNumber);
                  if (!issueRes.success) continue;
                  if (issueRes.data.state === 'closed') {
                    logger.info(
                      `[兜底同步] Issue #${s.issueNumber} 已关闭，同步状态`,
                    );
                    const session = new SessionManager(
                      s.owner,
                      s.repo,
                      s.issueNumber,
                    );
                    await session.transition({
                      type: EVENT.ISSUE_CLOSED,
                      message: 'Issue 已关闭（兜底同步）',
                    });
                    await syncLifecycleLabel(
                      s.owner,
                      s.repo,
                      s.issueNumber,
                      LIFECYCLE.COMPLETED,
                    );
                    const cleanRes = await cleanupIssue(
                      String(s.issueNumber),
                      { reason: 'fallback-sync', silent: true },
                      s.owner,
                      s.repo,
                      sRepoPath,
                    );
                    if (!cleanRes.success) {
                      logger.warn(
                        `[兜底同步] 清理 Issue #${s.issueNumber} 失败: ${cleanRes.error}`,
                      );
                    }
                  }
                } catch (err: unknown) {
                  logger.warn(
                    `[兜底同步] Issue #${s.issueNumber} 同步异常: ${getErrorMessage(err)}`,
                  );
                }
              }
            });
          }
        }

        return new Response(JSON.stringify(sessions), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // ── API: /api/restart ──
      if (url.pathname === '/api/restart' && req.method === 'POST') {
        try {
          const body = await req.json();
          const { owner, repo, issueNumber } = body;
          if (!owner || !repo || !issueNumber) {
            return new Response(
              JSON.stringify({ error: 'Missing owner, repo, or issueNumber' }),
              {
                status: 400,
                headers: {
                  'Content-Type': 'application/json',
                  'Access-Control-Allow-Origin': '*',
                },
              },
            );
          }
          logger.info(`手动重启 Issue #${issueNumber} (${owner}/${repo})...`);

          const apiRepoPath = registry.resolve(owner, repo);
          if (!apiRepoPath) {
            return new Response(
              JSON.stringify({
                error: `仓库 ${owner}/${repo} 未在本地工作区中注册`,
              }),
              {
                status: 400,
                headers: {
                  'Content-Type': 'application/json',
                  'Access-Control-Allow-Origin': '*',
                },
              },
            );
          }

          const issue = new Issue(issueNumber, config);
          const loadRes = await issue.load();
          if (!loadRes.success) {
            return new Response(
              JSON.stringify({
                error: `无法获取 Issue 状态: ${loadRes.error}`,
              }),
              {
                status: 500,
                headers: {
                  'Content-Type': 'application/json',
                  'Access-Control-Allow-Origin': '*',
                },
              },
            );
          }
          const healthRes = issue.checkHealth({ skipWipCheck: true });
          if (!healthRes.success) {
            return new Response(JSON.stringify({ error: healthRes.error }), {
              status: 409,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            });
          }

          enqueueAgent(`Issue #${issueNumber} 手动重启`, async () => {
            const sessionRes = readSession(owner, repo, issueNumber);
            const phase =
              sessionRes.success && sessionRes.data?.phase
                ? sessionRes.data.phase
                : 'planning';
            const title =
              sessionRes.success && sessionRes.data?.title
                ? sessionRes.data.title
                : `Issue #${issueNumber}`;
            const res = await launchIssueAgent(
              owner,
              repo,
              issueNumber,
              phase,
              {
                trigger: 'manual-restart',
                taskData: { title },
                repoPath: apiRepoPath,
              },
            );
            if (!res.success)
              logger.error(`手动重启 Issue #${issueNumber} 失败: ${res.error}`);
          });
          return new Response(
            JSON.stringify({ message: `已触发重启 Issue #${issueNumber}` }),
            {
              status: 202,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            },
          );
        } catch (e: unknown) {
          return new Response(JSON.stringify({ error: getErrorMessage(e) }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      }

      // ── API: /api/cleanup ──
      if (url.pathname === '/api/cleanup' && req.method === 'POST') {
        try {
          const body = await req.json();
          const { owner, repo, issueNumber } = body;
          if (!owner || !repo || !issueNumber) {
            return new Response(
              JSON.stringify({ error: 'Missing owner, repo, or issueNumber' }),
              {
                status: 400,
                headers: {
                  'Content-Type': 'application/json',
                  'Access-Control-Allow-Origin': '*',
                },
              },
            );
          }
          logger.info(
            `清理 Issue #${issueNumber} 的 worktree (${owner}/${repo})...`,
          );
          const res = await cleanupIssue(
            String(issueNumber),
            { force: true, reason: 'dashboard', silent: true },
            owner,
            repo,
            registry.resolve(owner, repo),
          );
          if (!res.success) {
            return new Response(JSON.stringify({ error: res.error }), {
              status: 500,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            });
          }
          return new Response(
            JSON.stringify({
              message: `已清理 Issue #${issueNumber} 的 worktree`,
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            },
          );
        } catch (e: unknown) {
          return new Response(JSON.stringify({ error: getErrorMessage(e) }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      }

      // ── API: /api/delete ──
      if (url.pathname === '/api/delete' && req.method === 'POST') {
        try {
          const body = await req.json();
          const { owner, repo, issueNumber } = body;
          if (!owner || !repo || !issueNumber) {
            return new Response(
              JSON.stringify({ error: 'Missing owner, repo, or issueNumber' }),
              {
                status: 400,
                headers: {
                  'Content-Type': 'application/json',
                  'Access-Control-Allow-Origin': '*',
                },
              },
            );
          }
          logger.info(
            `彻底删除 Issue #${issueNumber} 的本地资产 (${owner}/${repo})...`,
          );
          const deleteRepoPath = registry.resolve(owner, repo);
          const res = await cleanupIssueAssets(
            String(issueNumber),
            { force: true, reason: 'dashboard-delete', silent: true },
            owner,
            repo,
            deleteRepoPath,
          );
          if (!res.success) {
            return new Response(JSON.stringify({ error: res.error }), {
              status: 500,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            });
          }
          return new Response(
            JSON.stringify({
              message: `已彻底删除 Issue #${issueNumber} 的本地资产`,
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            },
          );
        } catch (e: unknown) {
          return new Response(JSON.stringify({ error: getErrorMessage(e) }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      }

      // ── API: /api/rescan ──
      if (url.pathname === '/api/rescan' && req.method === 'POST') {
        try {
          await registry.rescan();
          const repos = Object.fromEntries(registry.listAll());
          logger.info(
            `工作区重新扫描完成，已注册 ${Object.keys(repos).length} 个仓库`,
          );
          return new Response(
            JSON.stringify({ message: 'rescan completed', repos }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            },
          );
        } catch (e: unknown) {
          return new Response(JSON.stringify({ error: getErrorMessage(e) }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      }

      // ── NEW API: /api/logs/global ──
      if (url.pathname === '/api/logs/global' && req.method === 'GET') {
        const category = parseLogCategories(url.searchParams.get('category'));
        const level = parseLogLevels(url.searchParams.get('level'));
        const maxLines = url.searchParams.has('maxLines')
          ? Number(url.searchParams.get('maxLines'))
          : 200;
        const since = url.searchParams.get('since') || undefined;
        const entries = readGlobalLogFn({ category, level, maxLines, since });
        return new Response(JSON.stringify(entries), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // ── NEW API: /api/logs/session ──
      if (url.pathname === '/api/logs/session' && req.method === 'GET') {
        const query = getSessionQuery(url);
        if (!query) {
          return new Response(
            JSON.stringify({ error: '缺少 owner/repo/issueNumber 参数' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            },
          );
        }
        const category = parseLogCategories(url.searchParams.get('category'));
        const level = parseLogLevels(url.searchParams.get('level'));
        const maxLines = url.searchParams.has('maxLines')
          ? Number(url.searchParams.get('maxLines'))
          : 500;
        const since = url.searchParams.get('since') || undefined;
        const entries = readSessionLogFn(
          query.owner,
          query.repo,
          query.issueNumber,
          { category, level, maxLines, since },
        );
        return new Response(JSON.stringify(entries), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // ── NEW API: /api/logs/global/stream (SSE) ──
      if (url.pathname === '/api/logs/global/stream' && req.method === 'GET') {
        const logPath = getGlobalLogPathFn();
        return createLogSSEResponse(logPath, req);
      }

      // ── NEW API: /api/logs/session/stream (SSE) ──
      if (url.pathname === '/api/logs/session/stream' && req.method === 'GET') {
        const query = getSessionQuery(url);
        if (!query) {
          return new Response(
            JSON.stringify({ error: '缺少 owner/repo/issueNumber 参数' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            },
          );
        }
        const logPath = getSessionLogPathFn(
          query.owner,
          query.repo,
          query.issueNumber,
        );
        return createLogSSEResponse(logPath, req);
      }

      // ── NEW API: /api/logs/conversation/files ──
      if (
        url.pathname === '/api/logs/conversation/files' &&
        req.method === 'GET'
      ) {
        const query = getSessionQuery(url);
        if (!query) {
          return new Response(
            JSON.stringify({ error: '缺少 owner/repo/issueNumber 参数' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            },
          );
        }
        const files = listConversationFiles(
          query.owner,
          query.repo,
          query.issueNumber,
        );
        return new Response(JSON.stringify(files), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // ── NEW API: /api/logs/conversation ──
      if (url.pathname === '/api/logs/conversation' && req.method === 'GET') {
        const query = getSessionQuery(url);
        if (!query) {
          return new Response(
            JSON.stringify({ error: '缺少 owner/repo/issueNumber 参数' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            },
          );
        }
        const file = url.searchParams.get('file');
        if (!file) {
          return new Response(JSON.stringify({ error: '缺少 file 参数' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
        const dir = getConversationDir(
          query.owner,
          query.repo,
          query.issueNumber,
        );
        const filePath = path.join(dir, path.basename(file));
        const maxLines = url.searchParams.has('maxLines')
          ? Number(url.searchParams.get('maxLines'))
          : undefined;
        const entries = readConversationFile(filePath, { maxLines });
        return new Response(JSON.stringify(entries), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // ── NEW API: /api/logs/conversation/stream (SSE) ──
      if (
        url.pathname === '/api/logs/conversation/stream' &&
        req.method === 'GET'
      ) {
        const query = getSessionQuery(url);
        if (!query) {
          return new Response(
            JSON.stringify({ error: '缺少 owner/repo/issueNumber 参数' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            },
          );
        }
        const file = url.searchParams.get('file');
        if (!file) {
          return new Response(JSON.stringify({ error: '缺少 file 参数' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
        const dir = getConversationDir(
          query.owner,
          query.repo,
          query.issueNumber,
        );
        const logPath = path.join(dir, path.basename(file));
        return createLogSSEResponse(logPath, req);
      }

      // ── NEW API: /api/logs/diagnostic ──
      if (url.pathname === '/api/logs/diagnostic' && req.method === 'GET') {
        const query = getSessionQuery(url);
        if (!query) {
          return new Response(
            JSON.stringify({ error: '缺少 owner/repo/issueNumber 参数' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            },
          );
        }
        const paths = new SessionPathManager(
          query.owner,
          query.repo,
          query.issueNumber,
        );
        let diagnostic = readSessionDiagnostic(paths);
        if (!diagnostic) {
          const sessionRes = readSession(
            query.owner,
            query.repo,
            query.issueNumber,
          );
          if (sessionRes.success && sessionRes.data) {
            diagnostic = generateSessionDiagnostic(sessionRes.data, paths);
          }
        }
        return new Response(JSON.stringify(diagnostic), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // ── Static Web UI ──
      if (req.method === 'GET' && useDashboard) {
        try {
          const webDist = resolveWebDistDir();
          const reqPath = url.pathname === '/' ? '/index.html' : url.pathname;
          const filePath = path.join(webDist, reqPath);

          // Check if it's a regular file that exists
          const file = Bun.file(filePath);
          if (await file.exists()) {
            return new Response(file);
          }

          // Fallback to index.html for SPA routing
          const fallbackFile = Bun.file(path.join(webDist, 'index.html'));
          if (await fallbackFile.exists()) {
            return new Response(fallbackFile);
          }
        } catch (_e) {}
      }

      return new Response('Not Found', { status: 404 });
    },
  });

  logger.success(`Webhook 服务器已启动: http://${host}:${port}`);
  logger.info(`健康检查: http://${host}:${port}/health`);
  logger.info(`Webhook 端点: http://${host}:${port}/webhook`);
  if (secret) {
    logger.info('签名验证: 已启用');
  }

  // ── 优雅关闭 ──
  const shutdown = () => {
    logger.info('收到关闭信号，准备退出...');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // ── Dashboard 模式 ──
  if (useDashboard) {
    setDashboardMode(true);
    const dashboardUrl = `http://localhost:${port}`;
    logger.info(`Web Dashboard 正在运行: ${dashboardUrl}`);
    try {
      // 尝试自动打开浏览器
      const { exec } = await import('node:child_process');
      exec(`start ${dashboardUrl}`);
    } catch (_e) {}
  } else {
    logger.info('按 Ctrl+C 停止服务器');
  }
}

main().catch((err) => {
  logger.error('启动失败:', err);
  process.exit(1);
});
