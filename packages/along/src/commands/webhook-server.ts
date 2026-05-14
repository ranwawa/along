#!/usr/bin/env bun

// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: server entrypoint centralizes route wiring.
// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: server entrypoint centralizes route wiring.
// biome-ignore-all lint/style/noMagicNumbers: server route status codes and defaults are clearer inline.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Command } from 'commander';
import { consola } from 'consola';
import { calculate_runtime, check_process_running } from '../core/common';
import { config } from '../core/config';
import { findAllSessions, readSession } from '../core/db';
import { SessionPathManager } from '../core/session-paths';
import {
  generateSessionDiagnostic,
  readSessionDiagnostic,
} from '../domain/session-diagnostics';
import { isActiveSessionStatus } from '../domain/session-state-machine';
import { runTaskDelivery } from '../domain/task-delivery';
import { runTaskImplementationAgent } from '../domain/task-implementation-agent';
import { recoverInterruptedTaskAgentRuns } from '../domain/task-planning';
import { runTaskPlanningAgent } from '../domain/task-planning-agent';
import { runTaskTitleSummary } from '../domain/task-title-summary';
import {
  handleRegistryApiRequest,
  isRegistryApiPath,
} from '../integration/ai-registry-api';
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
  buildRegistry,
  type WorkspaceRegistry,
} from '../integration/workspace-registry';
import { initLogRouter } from '../logging/log-router';
import type { LogCategory, UnifiedLogEntry } from '../logging/log-types';
import {
  getConversationDir,
  getGlobalLogPath,
  getSessionLogPath,
  listConversationFiles,
  readConversationFile,
  readGlobalLog,
  readSessionLog,
} from './log-reader';

const logger = consola.withTag('webhook-server');
const require = createRequire(import.meta.url);
const MAX_CONCURRENT_AGENTS = Number(
  process.env.ALONG_MAX_CONCURRENT_AGENTS || '3',
);

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

interface RepositoryOption {
  owner: string;
  repo: string;
  fullName: string;
  path: string;
  isDefault: boolean;
}

type DashboardLifecycle =
  | 'running'
  | 'waiting_human'
  | 'waiting_external'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'zombie';

let registry: WorkspaceRegistry;
let runningAgents = 0;
const agentQueue: Array<{ label: string; fn: () => Promise<unknown> }> = [];
const taskLocks = new Map<string, Promise<void>>();

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function notFound(): Response {
  return new Response('Not Found', { status: 404 });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getWorkspaces(): string[] {
  const raw = process.env.ALONG_WORKSPACES || process.cwd();
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveWebDistDir(): string {
  try {
    const packageJsonPath = require.resolve('@ranwawa/along-web/package.json');
    return path.join(path.dirname(packageJsonPath), 'dist');
  } catch {
    return path.resolve(import.meta.dir, '..', '..', '..', 'along-web', 'dist');
  }
}

function parseLogCategories(value: string | null): LogCategory[] | undefined {
  const items = value
    ?.split(',')
    .filter((item): item is LogCategory =>
      ['lifecycle', 'conversation', 'diagnostic', 'webhook', 'server'].includes(
        item,
      ),
    );
  return items && items.length > 0 ? items : undefined;
}

function parseLogLevels(
  value: string | null,
): UnifiedLogEntry['level'][] | undefined {
  const items = value
    ?.split(',')
    .filter((item): item is UnifiedLogEntry['level'] =>
      ['info', 'warn', 'error', 'success'].includes(item),
    );
  return items && items.length > 0 ? items : undefined;
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

function createLogSSEResponse(logPath: string, req: Request): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        let lastSize = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
        const timer = setInterval(() => {
          if (!fs.existsSync(logPath)) return;
          const stat = fs.statSync(logPath);
          if (stat.size <= lastSize) return;
          const fd = fs.openSync(logPath, 'r');
          const buffer = Buffer.alloc(stat.size - lastSize);
          fs.readSync(fd, buffer, 0, buffer.length, lastSize);
          fs.closeSync(fd);
          lastSize = stat.size;
          const entries = buffer
            .toString('utf-8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .flatMap((line) => {
              try {
                return [JSON.parse(line)];
              } catch {
                return [];
              }
            });
          for (const entry of entries) {
            controller.enqueue(`data: ${JSON.stringify(entry)}\n\n`);
          }
        }, 1000);
        req.signal.addEventListener('abort', () => clearInterval(timer));
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
  const match = [...registry.listAll()]
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
    .sort((left, right) => right.pathLength - left.pathLength)[0];
  return match ? { repoOwner: match.owner, repoName: match.repo } : undefined;
}

function enqueueAgent(label: string, fn: () => Promise<unknown>) {
  if (runningAgents < MAX_CONCURRENT_AGENTS) {
    runAgent(label, fn);
    return;
  }
  logger.info(
    `[并发限制] ${label} 已排队（当前 ${runningAgents}/${MAX_CONCURRENT_AGENTS} 运行中，队列 ${agentQueue.length} 个）`,
  );
  agentQueue.push({ label, fn });
}

function runAgent(label: string, fn: () => Promise<unknown>) {
  runningAgents++;
  logger.info(
    `[并发限制] ${label} 开始执行（${runningAgents}/${MAX_CONCURRENT_AGENTS}）`,
  );
  fn()
    .catch((error) => {
      logger.error(`[并发限制] ${label} 执行异常: ${getErrorMessage(error)}`);
    })
    .finally(() => {
      runningAgents--;
      logger.info(
        `[并发限制] ${label} 执行完毕（${runningAgents}/${MAX_CONCURRENT_AGENTS}，队列 ${agentQueue.length} 个）`,
      );
      const next = agentQueue.shift();
      if (next) runAgent(next.label, next.fn);
    });
}

function withTaskLock(taskId: string, fn: () => Promise<void>): Promise<void> {
  const previous = taskLocks.get(taskId) || Promise.resolve();
  const next = previous.then(fn, fn);
  taskLocks.set(taskId, next);
  next.finally(() => {
    if (taskLocks.get(taskId) === next) taskLocks.delete(taskId);
  });
  return next;
}

function isTaskAgentCancellationError(error: string): boolean {
  return error.includes('已取消') || error.includes('已中断');
}

function enqueueTaskPlanningRun(input: ScheduledTaskPlanningRun) {
  enqueueAgent(`Task ${input.taskId} planning`, async () => {
    await withTaskLock(input.taskId, async () => {
      logger.info(`[Task ${input.taskId}] planning 开始: ${input.reason}`);
      const result = await runTaskPlanningAgent(input);
      if (!result.success) {
        if (isTaskAgentCancellationError(result.error)) {
          logger.info(`[Task ${input.taskId}] planning 已中断`);
          return;
        }
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
      }
    });
  });
}

function enqueueTaskImplementationRun(input: ScheduledTaskImplementationRun) {
  enqueueAgent(`Task ${input.taskId} implementation`, async () => {
    await withTaskLock(input.taskId, async () => {
      logger.info(
        `[Task ${input.taskId}] implementation 开始: ${input.reason}`,
      );
      const result = await runTaskImplementationAgent(input);
      if (!result.success) {
        if (isTaskAgentCancellationError(result.error)) {
          logger.info(`[Task ${input.taskId}] implementation 已中断`);
          return;
        }
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
      }
    });
  });
}

function enqueueTaskDeliveryRun(input: ScheduledTaskDeliveryRun) {
  enqueueAgent(`Task ${input.taskId} delivery`, async () => {
    await withTaskLock(input.taskId, async () => {
      logger.info(`[Task ${input.taskId}] delivery 开始: ${input.reason}`);
      const result = await runTaskDelivery(input);
      if (!result.success) {
        logger.error(`[Task ${input.taskId}] delivery 失败: ${result.error}`);
        return;
      }
      logger.info(`[Task ${input.taskId}] delivery 完成: ${result.data.prUrl}`);
    });
  });
}

function runScheduledTaskTitleSummary(input: ScheduledTaskTitleSummaryRun) {
  void runTaskTitleSummary(input).then((result) => {
    if (!result.success) {
      logger.warn(`[Task ${input.taskId}] 标题自动总结失败: ${result.error}`);
    }
  });
}

async function handleSessionsRequest(): Promise<Response> {
  const allRes = findAllSessions();
  if (!allRes.success) return jsonResponse({ error: allRes.error }, 500);

  const sessions = [];
  for (const info of allRes.data) {
    const res = readSession(info.owner, info.repo, info.issueNumber);
    if (!res.success || !res.data) continue;
    let lifecycle: DashboardLifecycle = res.data.lifecycle;
    if (isActiveSessionStatus(lifecycle) && res.data.pid) {
      const alive = await check_process_running(res.data.pid);
      if (!alive) lifecycle = 'zombie';
    }
    sessions.push({
      ...res.data,
      lifecycle,
      owner: info.owner,
      repo: info.repo,
      runtime: calculate_runtime(res.data.startTime),
      hasWorktree: res.data.worktreePath
        ? fs.existsSync(res.data.worktreePath)
        : false,
    });
  }

  return jsonResponse(sessions);
}

function handleSessionDiagnosticRequest(url: URL): Response {
  const query = getSessionQuery(url);
  if (!query)
    return jsonResponse({ error: '缺少 owner/repo/issueNumber 参数' }, 400);
  const paths = new SessionPathManager(
    query.owner,
    query.repo,
    query.issueNumber,
  );
  let diagnostic = readSessionDiagnostic(paths);
  if (!diagnostic) {
    const sessionRes = readSession(query.owner, query.repo, query.issueNumber);
    if (sessionRes.success && sessionRes.data) {
      diagnostic = generateSessionDiagnostic(sessionRes.data, paths);
    }
  }
  return jsonResponse(diagnostic);
}

function handleLogRequest(url: URL): Response {
  const category = parseLogCategories(url.searchParams.get('category'));
  const level = parseLogLevels(url.searchParams.get('level'));
  const maxLines = url.searchParams.has('maxLines')
    ? Number(url.searchParams.get('maxLines'))
    : undefined;
  const since = url.searchParams.get('since') || undefined;

  if (url.pathname === '/api/logs/global') {
    return jsonResponse(readGlobalLog({ category, level, maxLines, since }));
  }

  const query = getSessionQuery(url);
  if (!query)
    return jsonResponse({ error: '缺少 owner/repo/issueNumber 参数' }, 400);
  return jsonResponse(
    readSessionLog(query.owner, query.repo, query.issueNumber, {
      category,
      level,
      maxLines,
      since,
    }),
  );
}

function handleConversationRequest(url: URL): Response {
  const query = getSessionQuery(url);
  if (!query)
    return jsonResponse({ error: '缺少 owner/repo/issueNumber 参数' }, 400);

  if (url.pathname === '/api/logs/conversation/files') {
    return jsonResponse(
      listConversationFiles(query.owner, query.repo, query.issueNumber),
    );
  }

  const file = url.searchParams.get('file');
  if (!file) return jsonResponse({ error: '缺少 file 参数' }, 400);
  const filePath = path.join(
    getConversationDir(query.owner, query.repo, query.issueNumber),
    path.basename(file),
  );
  const maxLines = url.searchParams.has('maxLines')
    ? Number(url.searchParams.get('maxLines'))
    : undefined;
  return jsonResponse(readConversationFile(filePath, { maxLines }));
}

function handleStreamRequest(url: URL, req: Request): Response {
  if (url.pathname === '/api/logs/global/stream') {
    return createLogSSEResponse(getGlobalLogPath(), req);
  }

  const query = getSessionQuery(url);
  if (!query)
    return jsonResponse({ error: '缺少 owner/repo/issueNumber 参数' }, 400);

  if (url.pathname === '/api/logs/session/stream') {
    return createLogSSEResponse(
      getSessionLogPath(query.owner, query.repo, query.issueNumber),
      req,
    );
  }

  const file = url.searchParams.get('file');
  if (!file) return jsonResponse({ error: '缺少 file 参数' }, 400);
  return createLogSSEResponse(
    path.join(
      getConversationDir(query.owner, query.repo, query.issueNumber),
      path.basename(file),
    ),
    req,
  );
}

async function handleStaticRequest(url: URL): Promise<Response | null> {
  const reqPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const webDist = resolveWebDistDir();
  const file = Bun.file(path.join(webDist, reqPath));
  if (await file.exists()) return new Response(file);
  const fallback = Bun.file(path.join(webDist, 'index.html'));
  return (await fallback.exists()) ? new Response(fallback) : null;
}

async function main() {
  config.ensureDataDirs();

  const program = new Command()
    .name('along webhook-server')
    .description('启动 Along Web Task 本地开发服务')
    .option('--port <port>', '监听端口', '9876')
    .option('--host <host>', '监听地址', '0.0.0.0')
    .parse(process.argv);

  const opts = program.opts<{ port: string; host: string }>();
  const port = Number(opts.port);
  const host = opts.host;
  const registryRes = await buildRegistry(getWorkspaces());
  if (!registryRes.success) {
    logger.error(`工作区扫描失败: ${registryRes.error}`);
    process.exit(1);
  }
  registry = registryRes.data;

  initLogRouter();
  logger.info(`已注册 ${registry.listAll().size} 个仓库`);
  for (const [key, localPath] of registry.listAll()) {
    logger.info(`  ${key} -> ${localPath}`);
  }

  const recoveredRunsRes = recoverInterruptedTaskAgentRuns(
    'Server 启动时发现上次 Agent run 未正常结束，已标记为失败。',
  );
  if (!recoveredRunsRes.success) {
    logger.warn(`恢复中断的 Agent Run 失败: ${recoveredRunsRes.error}`);
  } else if (recoveredRunsRes.data.recoveredRuns.length > 0) {
    logger.warn(
      `已恢复 ${recoveredRunsRes.data.recoveredRuns.length} 个中断的 Agent Run`,
    );
  }

  Bun.serve({
    hostname: host,
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      }

      if (url.pathname === '/health') {
        return jsonResponse({
          status: 'ok',
          timestamp: new Date().toISOString(),
        });
      }

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

      if (isRegistryApiPath(url.pathname)) {
        return handleRegistryApiRequest(req);
      }

      if (url.pathname === '/api/repositories' && req.method === 'GET') {
        return jsonResponse(listRepositoryOptions(process.cwd()));
      }

      if (url.pathname === '/api/sessions' && req.method === 'GET') {
        return handleSessionsRequest();
      }

      if (url.pathname === '/api/logs/diagnostic' && req.method === 'GET') {
        return handleSessionDiagnosticRequest(url);
      }

      if (
        (url.pathname === '/api/logs/global' ||
          url.pathname === '/api/logs/session') &&
        req.method === 'GET'
      ) {
        return handleLogRequest(url);
      }

      if (
        (url.pathname === '/api/logs/global/stream' ||
          url.pathname === '/api/logs/session/stream' ||
          url.pathname === '/api/logs/conversation/stream') &&
        req.method === 'GET'
      ) {
        return handleStreamRequest(url, req);
      }

      if (
        (url.pathname === '/api/logs/conversation/files' ||
          url.pathname === '/api/logs/conversation') &&
        req.method === 'GET'
      ) {
        return handleConversationRequest(url);
      }

      if (
        ['/api/restart', '/api/cleanup', '/api/delete'].includes(
          url.pathname,
        ) &&
        req.method === 'POST'
      ) {
        return jsonResponse({ error: 'GitHub Issue session 操作已移除' }, 410);
      }

      if (req.method === 'GET') {
        const staticResponse = await handleStaticRequest(url);
        if (staticResponse) return staticResponse;
      }

      return notFound();
    },
  });

  logger.success(`Along server 已启动: http://${host}:${port}`);
  logger.info(`健康检查: http://${host}:${port}/health`);

  const shutdown = () => {
    logger.info('收到关闭信号，准备退出...');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  logger.error(`启动失败: ${getErrorMessage(error)}`);
  process.exit(1);
});
