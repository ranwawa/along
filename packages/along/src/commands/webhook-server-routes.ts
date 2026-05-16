import { createRequire } from 'node:module';
import path from 'node:path';
import {
  handleRegistryApiRequest,
  isRegistryApiPath,
} from '../integration/ai-registry-api';
import {
  HTTP_NO_CONTENT,
  HTTP_NOT_FOUND,
  HTTP_OK,
} from '../integration/http-status';
import { handleTaskApiRequest, isTaskApiPath } from '../integration/task-api';
import type { WorkspaceRegistry } from '../integration/workspace-registry';
import {
  enqueueTaskDeliveryRun,
  enqueueTaskExecRun,
  enqueueTaskPlanningRun,
  runScheduledTaskTitleSummary,
} from './webhook-server-agent-queue';

const require = createRequire(import.meta.url);

interface RepositoryOption {
  owner: string;
  repo: string;
  fullName: string;
  path: string;
  isDefault: boolean;
}

interface BunFile extends Blob {
  exists(): Promise<boolean>;
}

declare const Bun: {
  file(filePath: string): BunFile;
};

export function jsonResponse(payload: unknown, status = HTTP_OK): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export function notFound(): Response {
  return new Response('Not Found', { status: HTTP_NOT_FOUND });
}

export function getWorkspaces(): string[] {
  const raw = process.env.ALONG_WORKSPACES || process.cwd();
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveWebDistDir(): string {
  try {
    const packageJsonPath = require.resolve('@ranwawa/along-web/package.json');
    return path.join(path.dirname(packageJsonPath), 'dist');
  } catch {
    return path.resolve(import.meta.dir, '..', '..', '..', 'along-web', 'dist');
  }
}

export function listRepositoryOptions(
  registry: WorkspaceRegistry,
  defaultCwd: string,
): { repositories: RepositoryOption[]; defaultRepository?: string } {
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

export function resolveRepositoryForPath(
  registry: WorkspaceRegistry,
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

async function handleStaticRequest(url: URL): Promise<Response | null> {
  const reqPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const webDist = resolveWebDistDir();
  const file = Bun.file(path.join(webDist, reqPath));
  if (await file.exists()) return new Response(file);
  const fallback = Bun.file(path.join(webDist, 'index.html'));
  return (await fallback.exists()) ? new Response(fallback) : null;
}

function optionsResponse(): Response {
  return new Response(null, {
    status: HTTP_NO_CONTENT,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function handleRequest(
  req: Request,
  registry: WorkspaceRegistry,
): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') return optionsResponse();

  if (url.pathname === '/health') {
    return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
  }

  if (isTaskApiPath(url.pathname)) {
    return handleTaskApiRequest(req, url, {
      defaultCwd: process.cwd(),
      resolveRepoPath: (owner, repo) => registry.resolve(owner, repo),
      resolveRepositoryForPath: (cwd) =>
        resolveRepositoryForPath(registry, cwd),
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
    return jsonResponse(listRepositoryOptions(registry, process.cwd()));
  }

  if (req.method === 'GET') {
    const staticResponse = await handleStaticRequest(url);
    if (staticResponse) return staticResponse;
  }

  return notFound();
}
