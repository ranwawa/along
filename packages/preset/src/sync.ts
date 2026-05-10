import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import consola from 'consola';
import { EDITOR_PROMPT_DIRS, EDITOR_SKILL_DIRS } from './editor-targets';
import { writeGeneratedFiles } from './file-utils';
import { loadManagedProject } from './project-config';
import { ensureManagedProjectConfig } from './project-init';
import { buildExpectedFiles } from './sync-generated-files';
import type { GeneratedFile, LoadedManagedProject } from './types';

const logger = consola.withTag('preset');

export interface SyncProjectOptions {
  yes?: boolean;
  interactive?: boolean;
  check?: boolean;
}

export async function syncProject(
  projectPath = '.',
  options: SyncProjectOptions = {},
) {
  const projectDir = path.resolve(process.cwd(), projectPath);
  ensureProjectShape(projectDir, {
    requireClean: !options.check,
  });

  if (!options.check) {
    await ensureManagedProjectConfig(projectDir, options);
  }

  const project = loadManagedProject(projectDir);
  const expectedFiles = buildExpectedFiles(project);

  if (options.check) {
    checkProjectDrift(project, expectedFiles);
    return;
  }

  logger.start(`开始同步项目基建资产: ${project.resolved.id}`);

  cleanupManagedOutputRoots(project);
  writeGeneratedFiles(project.projectDir, expectedFiles);

  logger.success(`同步完成: ${project.projectDir}`);
}

function ensureProjectShape(
  projectDir: string,
  options: { requireClean: boolean },
) {
  const packageJsonPath = path.join(projectDir, 'package.json');
  const gitPath = path.join(projectDir, '.git');

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`目标目录缺少 package.json: ${projectDir}`);
  }

  if (!fs.existsSync(gitPath)) {
    throw new Error(`目标目录不是 Git 仓库: ${projectDir}`);
  }

  if (!options.requireClean) {
    return;
  }

  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: projectDir,
    encoding: 'utf8',
  });

  if (status.error) {
    throw status.error;
  }

  if (typeof status.status === 'number' && status.status !== 0) {
    const details = status.stderr?.trim();
    throw new Error(
      details
        ? `检查 Git 工作区状态失败: ${details}`
        : '检查 Git 工作区状态失败',
    );
  }

  if (status.stdout.trim()) {
    throw new Error(
      '目标仓库存在未提交变更。请先提交、暂存或清理工作区后再运行 along project-sync。',
    );
  }
}

function cleanupManagedOutputRoots(project: LoadedManagedProject) {
  for (const relativePath of getManagedOutputRoots(project)) {
    const targetPath = path.join(project.projectDir, relativePath);
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function getManagedOutputRoots(project: LoadedManagedProject): string[] {
  const pathsToReset = ['.along/preset', '.along/git-hooks'];

  for (const editor of project.resolved.agent.editors) {
    pathsToReset.push(EDITOR_PROMPT_DIRS[editor], EDITOR_SKILL_DIRS[editor]);
  }

  if (project.resolved.ci?.qualityGateAction?.enabled) {
    pathsToReset.push('.github/actions/along-quality-gate');
  }

  return [...new Set(pathsToReset)];
}

function checkProjectDrift(
  project: LoadedManagedProject,
  expectedFiles: GeneratedFile[],
) {
  const drifts: Array<{ path: string; reason: string }> = [];
  const expectedPathSet = new Set(expectedFiles.map((file) => file.path));

  for (const file of expectedFiles) {
    const actualPath = path.join(project.projectDir, file.path);

    if (!fs.existsSync(actualPath)) {
      drifts.push({ path: file.path, reason: '缺少受管文件' });
      continue;
    }

    const actualContent = fs.readFileSync(actualPath, 'utf8');
    if (actualContent !== file.content) {
      drifts.push({ path: file.path, reason: '内容与预期不一致' });
    }
  }

  for (const filePath of collectManagedOutputFilePaths(project)) {
    if (!expectedPathSet.has(filePath)) {
      drifts.push({ path: filePath, reason: '存在未受管的历史文件' });
    }
  }

  if (drifts.length === 0) {
    logger.success(`项目基建资产无漂移: ${project.projectDir}`);
    return;
  }

  logger.error('检测到项目基建资产漂移:');
  for (const drift of drifts) {
    logger.error(`  ${drift.path} - ${drift.reason}`);
  }

  throw new Error('项目基建资产存在漂移，请运行 along project-sync 修复。');
}

function collectManagedOutputFilePaths(
  project: LoadedManagedProject,
): string[] {
  const results: string[] = [];

  for (const outputRoot of getManagedOutputRoots(project)) {
    const absoluteRoot = path.join(project.projectDir, outputRoot);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }

    collectFiles(absoluteRoot);
  }

  return results.sort();

  function collectFiles(currentPath: string) {
    const stat = fs.lstatSync(currentPath);
    if (stat.isSymbolicLink() || stat.isFile()) {
      results.push(path.relative(project.projectDir, currentPath));
      return;
    }

    if (!stat.isDirectory()) {
      return;
    }

    for (const entry of fs.readdirSync(currentPath)) {
      collectFiles(path.join(currentPath, entry));
    }
  }
}
