import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import consola from 'consola';
import {
  collectBiomeFiles,
  collectHookFiles,
  collectPromptFiles,
  collectQualityEngineFiles,
  collectSkillFiles,
  renderQualityConfig,
} from './collect-assets';
import { EDITOR_PROMPT_DIRS, EDITOR_SKILL_DIRS } from './editor-targets';
import { hashContent, readText, writeGeneratedFiles } from './file-utils';
import { getPresetGitignorePath, getWorkspaceRoot } from './paths';
import {
  CONFIG_FILE_NAME,
  loadManagedProject,
  normalizeManagedProjectConfig,
} from './project-config';
import { ensureManagedProjectConfig } from './project-init';
import {
  renderAgentsDoc,
  renderClaudeMd,
  renderQualityGateAction,
} from './render-docs';
import type { GeneratedFile, LoadedManagedProject } from './types';

const logger = consola.withTag('preset');
const GIT_HOOKS_DIR = '.along/git-hooks';
const PREINSTALL_SCRIPT = `${GIT_HOOKS_DIR}/preinstall.ts`;
const QUALITY_CHANGED_SCRIPT =
  'bun ./.along/preset/scripts/quality/run-changed.mjs';
const QUALITY_FULL_SCRIPT = 'bun ./.along/preset/scripts/quality/run-full.mjs';

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

function buildGeneratedFiles(project: LoadedManagedProject): GeneratedFile[] {
  const files: GeneratedFile[] = [
    ...collectBiomeFiles(),
    {
      path: 'AGENTS.md',
      content: renderAgentsDoc(),
    },
    {
      path: '.along/preset/quality.config.json',
      content: renderQualityConfig(project),
    },
    ...collectHookFiles(),
    ...collectQualityEngineFiles(),
    ...collectPromptFiles(project),
    ...collectSkillFiles(project),
  ];

  if (project.resolved.agent.editors.includes('claude')) {
    files.push({
      path: 'CLAUDE.md',
      content: renderClaudeMd(),
    });
  }

  if (project.resolved.ci?.qualityGateAction?.enabled) {
    files.push({
      path: '.github/actions/along-quality-gate/action.yml',
      content: renderQualityGateAction(project),
    });
  }

  return dedupeGeneratedFiles(files);
}

function buildExpectedFiles(project: LoadedManagedProject): GeneratedFile[] {
  const assetFiles = buildGeneratedFiles(project);
  const nonManifestFiles = prepareGeneratedFiles([
    ...assetFiles,
    buildPackageJsonFile(project),
    buildProjectConfigFile(project),
    buildGitignoreFile(project),
  ]);

  return dedupeGeneratedFiles(
    prepareGeneratedFiles([
      ...nonManifestFiles,
      buildManifestFile(project, nonManifestFiles),
    ]),
  );
}

function dedupeGeneratedFiles(files: GeneratedFile[]): GeneratedFile[] {
  const seen = new Map<string, string>();

  for (const file of files) {
    seen.set(file.path, file.content);
  }

  return [...seen.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, content]) => ({
      path: filePath,
      content,
    }));
}

function buildPackageJsonFile(project: LoadedManagedProject): GeneratedFile {
  const packageJsonPath = path.join(project.projectDir, 'package.json');
  const packageJson = JSON.parse(readText(packageJsonPath));

  packageJson.scripts = packageJson.scripts || {};
  packageJson.scripts.preinstall = `bun ${PREINSTALL_SCRIPT}`;
  packageJson.scripts.prepare = `git config core.hooksPath ${GIT_HOOKS_DIR}`;
  packageJson.scripts['quality:changed'] = QUALITY_CHANGED_SCRIPT;
  packageJson.scripts['quality:full'] = QUALITY_FULL_SCRIPT;
  packageJson.devDependencies = packageJson.devDependencies || {};
  packageJson.devDependencies['@biomejs/biome'] = getManagedBiomeVersion();

  return {
    path: 'package.json',
    content: `${JSON.stringify(packageJson, null, 2)}\n`,
  };
}

function buildGitignoreFile(project: LoadedManagedProject): GeneratedFile {
  const gitignorePath = path.join(project.projectDir, '.gitignore');
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf8')
    : '';
  const startMarker = '# begin along managed assets';
  const endMarker = '# end along managed assets';
  const managedBlock = buildManagedGitignoreBlock();
  const blockContent = `${startMarker}\n${managedBlock}\n${endMarker}`;
  const pattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`, 'm');
  const next = pattern.test(existing)
    ? existing.replace(pattern, blockContent)
    : `${existing.replace(/\s*$/, '')}\n\n${blockContent}\n`;

  return {
    path: '.gitignore',
    content: next,
  };
}

function buildManagedGitignoreBlock(): string {
  return readText(getPresetGitignorePath()).trim();
}

function cleanupManagedOutputRoots(project: LoadedManagedProject) {
  for (const relativePath of getManagedOutputRoots(project)) {
    const targetPath = path.join(project.projectDir, relativePath);
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function getManagedOutputRoots(project: LoadedManagedProject): string[] {
  const pathsToReset = ['.along/preset', '.along/git-hooks', '.ranwawa'];

  for (const editor of project.resolved.agent.editors) {
    pathsToReset.push(
      EDITOR_PROMPT_DIRS[editor],
      path.dirname(EDITOR_SKILL_DIRS[editor]),
      EDITOR_SKILL_DIRS[editor],
    );
  }

  if (project.resolved.ci?.qualityGateAction?.enabled) {
    pathsToReset.push('.github/actions/along-quality-gate');
  }

  return [...new Set(pathsToReset)];
}

function buildManifestFile(
  project: LoadedManagedProject,
  generatedFiles: GeneratedFile[],
): GeneratedFile {
  const manifest = {
    managedBy: '@ranwawa/along',
    projectId: project.resolved.id,
    displayName: project.resolved.displayName,
    presetVersion: project.resolved.presetVersion,
    files: generatedFiles.map((file) => ({
      path: file.path,
      sha256: hashContent(file.content),
    })),
    packageJsonScripts: {
      preinstall: `bun ${PREINSTALL_SCRIPT}`,
      prepare: `git config core.hooksPath ${GIT_HOOKS_DIR}`,
      'quality:changed': QUALITY_CHANGED_SCRIPT,
      'quality:full': QUALITY_FULL_SCRIPT,
    },
    packageJsonDevDependencies: {
      '@biomejs/biome': getManagedBiomeVersion(),
    },
  };

  return {
    path: '.along/preset/manifest.json',
    content: `${JSON.stringify(manifest, null, 2)}\n`,
  };
}

function buildProjectConfigFile(project: LoadedManagedProject): GeneratedFile {
  const distribution = normalizeManagedProjectConfig(
    project.projectDir,
    project.config,
  );
  const nextValue = project.rootConfig
    ? {
        ...project.rootConfig,
        distribution,
      }
    : distribution;

  return {
    path: CONFIG_FILE_NAME,
    content: `${JSON.stringify(nextValue, null, 2)}\n`,
  };
}

function prepareGeneratedFiles(files: GeneratedFile[]): GeneratedFile[] {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'along-preset-'));

  try {
    writeGeneratedFiles(tempDir, files);
    prepareBiomeVcsIgnoreFiles(tempDir);
    runBiomeGeneratedCheck(tempDir, files, { write: true });
    runBiomeGeneratedCheck(tempDir, files, { write: false });

    return files.map((file) => ({
      ...file,
      content: fs.readFileSync(path.join(tempDir, file.path), 'utf8'),
    }));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function prepareBiomeVcsIgnoreFiles(tempDir: string) {
  const gitignoreContent = readText(getPresetGitignorePath());
  fs.writeFileSync(path.join(tempDir, '.gitignore'), gitignoreContent);
  fs.writeFileSync(
    path.join(tempDir, '.along/preset/.gitignore'),
    gitignoreContent,
  );
  const gitInfoDir = path.join(tempDir, '.git/info');
  fs.mkdirSync(gitInfoDir, { recursive: true });
  fs.writeFileSync(path.join(gitInfoDir, 'exclude'), '');
}

function runBiomeGeneratedCheck(
  tempDir: string,
  files: GeneratedFile[],
  options: { write: boolean },
) {
  const configPath = path.join(tempDir, '.along/preset/biome.shared.json');
  const args = [
    'biome',
    'check',
    ...(options.write ? ['--write'] : []),
    '--config-path',
    configPath,
    '--files-ignore-unknown=true',
    ...files.map((file) => path.join(tempDir, file.path)),
  ];
  const result = spawnSync('bunx', args, {
    cwd: getWorkspaceRoot(),
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    const details = [result.stdout, result.stderr]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join('\n');
    throw new Error(
      details
        ? `生成文件不符合共享 Biome 配置:\n${details}`
        : '生成文件不符合共享 Biome 配置',
    );
  }
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

function getManagedBiomeVersion(): string {
  const packageJson = JSON.parse(
    readText(path.join(getWorkspaceRoot(), 'package.json')),
  );

  return (
    packageJson.devDependencies?.['@biomejs/biome'] ||
    packageJson.dependencies?.['@biomejs/biome'] ||
    '^2.4.13'
  );
}
