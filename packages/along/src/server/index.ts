#!/usr/bin/env bun

import { Command } from 'commander';
import { consola } from 'consola';
import { initLogRouter } from '../adapters/logging/log-router';
import {
  buildRegistry,
  type WorkspaceRegistry,
} from '../adapters/workspace/registry';
import { recoverInterruptedTaskAgentRuns } from '../app/planning';
import { getErrorMessage } from '../core/common';
import { config } from '../core/config';
import { getWorkspaces, handleRequest } from './routes';

const logger = consola.withTag('webhook-server');

const DEFAULT_PORT = 9876;

declare const Bun: {
  serve(options: {
    hostname: string;
    port: number;
    fetch(req: Request): Response | Promise<Response>;
  }): unknown;
};

function logRecoveredRuns() {
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
}

function parseCliOpts(): { port: number; host: string } {
  const program = new Command()
    .name('along webhook-server')
    .description('启动 Along Web Task 本地开发服务')
    .option('--port <port>', '监听端口', String(DEFAULT_PORT))
    .option('--host <host>', '监听地址', '0.0.0.0')
    .parse(process.argv);
  const opts = program.opts<{ port: string; host: string }>();
  return { port: Number(opts.port), host: opts.host };
}

async function initRegistry(): Promise<WorkspaceRegistry> {
  const registryRes = await buildRegistry(getWorkspaces());
  if (!registryRes.success) {
    logger.error(`工作区扫描失败: ${registryRes.error}`);
    process.exit(1);
  }
  initLogRouter();
  logger.info(`已注册 ${registryRes.data.listAll().size} 个仓库`);
  for (const [key, localPath] of registryRes.data.listAll()) {
    logger.info(`  ${key} -> ${localPath}`);
  }
  return registryRes.data;
}

function registerShutdownHandlers() {
  const shutdown = () => {
    logger.info('收到关闭信号，准备退出...');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

async function main() {
  config.ensureDataDirs();
  const { port, host } = parseCliOpts();
  const registry = await initRegistry();
  logRecoveredRuns();
  Bun.serve({
    hostname: host,
    port,
    fetch: (req) => handleRequest(req, registry),
  });
  logger.success(`Along server 已启动: http://${host}:${port}`);
  logger.info(`健康检查: http://${host}:${port}/health`);
  registerShutdownHandlers();
}

main().catch((error) => {
  logger.error(`启动失败: ${getErrorMessage(error)}`);
  process.exit(1);
});
