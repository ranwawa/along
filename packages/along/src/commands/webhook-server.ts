#!/usr/bin/env bun

// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: server entrypoint centralizes route wiring.
// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: server entrypoint centralizes route wiring.
// biome-ignore-all lint/style/noMagicNumbers: server route status codes and defaults are clearer inline.
import { createRequire } from 'node:module';
import path from 'node:path';
import { Command } from 'commander';
import { consola } from 'consola';
import { config } from '../core/config';
import { runTaskDelivery } from '../domain/task-delivery';
import { runTaskExecAgent } from '../domain/task-exec-agent';
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
  type ScheduledTaskExecRun,
  type ScheduledTaskPlanningRun,
  type ScheduledTaskTitleSummaryRun,
} from '../integration/task-api';
import {
  continueAutonomousTaskAfterExec,
  continueAutonomousTaskAfterPlanning,
} from '../integration/task-autonomous-continuation';
import {
  buildRegistry,
  type WorkspaceRegistry,
} from '../integration/workspace-registry';
import { initLogRouter } from '../logging/log-router';

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
        scheduleExec: enqueueTaskExecRun,
      });
      if (!continuation.success) {
        logger.error(
          `[Task ${input.taskId}] autonomous planning 推进失败: ${continuation.error}`,
        );
      }
    });
  });
}

function enqueueTaskExecRun(input: ScheduledTaskExecRun) {
  enqueueAgent(`Task ${input.taskId} exec`, async () => {
    await withTaskLock(input.taskId, async () => {
      logger.info(`[Task ${input.taskId}] exec 开始: ${input.reason}`);
      const result = await runTaskExecAgent(input);
      if (!result.success) {
        if (isTaskAgentCancellationError(result.error)) {
          logger.info(`[Task ${input.taskId}] exec 已中断`);
          return;
        }
        logger.error(`[Task ${input.taskId}] exec 失败: ${result.error}`);
        return;
      }
      logger.info(`[Task ${input.taskId}] exec 完成`);
      const continuation = continueAutonomousTaskAfterExec({
        taskId: input.taskId,
        cwd: input.cwd,
        scheduleExec: enqueueTaskExecRun,
        scheduleDelivery: enqueueTaskDeliveryRun,
      });
      if (!continuation.success) {
        logger.error(
          `[Task ${input.taskId}] autonomous exec 推进失败: ${continuation.error}`,
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
          scheduleExec: enqueueTaskExecRun,
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
