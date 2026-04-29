import { consola } from 'consola';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';

const require = createRequire(import.meta.url);
const { simpleGit } = require('simple-git');

const logger = consola.withTag('workspace-registry');

export interface WorkspaceRegistry {
  resolve(owner: string, repo: string): string | undefined;
  rescan(): Promise<void>;
  listAll(): Map<string, string>;
}

function parseGitRemoteUrl(
  url: string,
): { owner: string; repo: string } | null {
  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(
    /https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  );
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  return null;
}

async function scanDirectory(dirPath: string): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  if (!fs.existsSync(dirPath)) {
    logger.warn(`工作区目录不存在: ${dirPath}`);
    return results;
  }

  const resolved = path.resolve(dirPath);

  // 检查目录自身是否是 git 仓库
  if (fs.existsSync(path.join(resolved, '.git'))) {
    const info = await readRepoInfo(resolved);
    if (info) {
      results.set(`${info.owner}/${info.repo}`, resolved);
    }
    return results;
  }

  // 扫描一级子目录
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch (e: any) {
    logger.warn(`读取工作区目录失败: ${resolved}: ${e.message}`);
    return results;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const subDir = path.join(resolved, entry.name);
    if (fs.existsSync(path.join(subDir, '.git'))) {
      const info = await readRepoInfo(subDir);
      if (info) {
        results.set(`${info.owner}/${info.repo}`, subDir);
      }
    }
  }

  return results;
}

async function readRepoInfo(
  repoPath: string,
): Promise<{ owner: string; repo: string } | null> {
  try {
    const git = simpleGit(repoPath);
    const remoteUrl = await git.remote(['get-url', 'origin']);
    if (!remoteUrl) return null;
    return parseGitRemoteUrl(remoteUrl.trim());
  } catch {
    return null;
  }
}

export async function buildRegistry(
  workspaceDirs: string[],
): Promise<Result<WorkspaceRegistry>> {
  const registry = new Map<string, string>();

  async function scan() {
    registry.clear();
    for (const dir of workspaceDirs) {
      const found = await scanDirectory(dir);
      for (const [key, val] of found) {
        if (registry.has(key)) {
          logger.warn(
            `仓库 ${key} 在多个位置发现，使用: ${registry.get(key)}，忽略: ${val}`,
          );
          continue;
        }
        registry.set(key, val);
      }
    }
    logger.info(
      `工作区扫描完成，发现 ${registry.size} 个仓库: ${[...registry.keys()].join(', ')}`,
    );
  }

  try {
    await scan();
  } catch (e: any) {
    return failure(`工作区扫描失败: ${e.message}`);
  }

  return success({
    resolve(owner: string, repo: string): string | undefined {
      return registry.get(`${owner}/${repo}`);
    },
    async rescan() {
      await scan();
    },
    listAll(): Map<string, string> {
      return new Map(registry);
    },
  });
}
