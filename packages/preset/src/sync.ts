import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import consola from 'consola';
import { EDITOR_PROMPT_DIRS, EDITOR_SKILL_DIRS } from './editor-targets';
import {
  ensureParentDir,
  hashContent,
  readText,
  writeGeneratedFiles,
} from './file-utils';
import { getWorkspaceRoot } from './paths';
import {
  loadManagedProject,
  resolveManagedProjectTarget,
} from './project-config';
import {
  renderAgentsDoc,
  renderQualityDoc,
  renderQualityGateAction,
} from './render-docs';
import {
  collectHookFiles,
  collectPromptFiles,
  collectQualityEngineFiles,
  collectSkillFiles,
  renderQualityConfig,
} from './render-quality-preset';
import type {
  GeneratedFile,
  LoadedManagedProject,
  ManagedAgentEditor,
} from './types';

const logger = consola.withTag('preset');

export async function syncProject(target: string) {
  const projectDir = resolveManagedProjectTarget(target);
  const project = loadManagedProject(projectDir);
  ensureProjectShape(project.projectDir);

  logger.start(`开始同步项目基建资产: ${project.config.id}`);

  const generatedFiles = formatGeneratedFiles(buildGeneratedFiles(project));
  cleanupManagedOutputRoots(project);
  writeGeneratedFiles(project.projectDir, generatedFiles);
  updatePackageJson(project);
  normalizeProjectConfigFile(project);
  updateGitignore(project);
  cleanupLegacyPaths(project);
  writeManifest(project, generatedFiles);

  logger.success(`同步完成: ${project.projectDir}`);
}

function ensureProjectShape(projectDir: string) {
  const packageJsonPath = path.join(projectDir, 'package.json');
  const gitPath = path.join(projectDir, '.git');

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`目标目录缺少 package.json: ${projectDir}`);
  }

  if (!fs.existsSync(gitPath)) {
    throw new Error(`目标目录不是 Git 仓库: ${projectDir}`);
  }
}

function buildGeneratedFiles(project: LoadedManagedProject): GeneratedFile[] {
  const files: GeneratedFile[] = [
    {
      path: 'AGENTS.md',
      content: renderAgentsDoc(project),
    },
    {
      path: 'QUALITY.md',
      content: renderQualityDoc(project),
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

  if (project.config.ci?.qualityGateAction?.enabled) {
    files.push({
      path: '.github/actions/along-quality-gate/action.yml',
      content: renderQualityGateAction(project),
    });
  }

  return dedupeGeneratedFiles(files);
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

function updatePackageJson(project: LoadedManagedProject) {
  const packageJsonPath = path.join(project.projectDir, 'package.json');
  const packageJson = JSON.parse(readText(packageJsonPath));

  packageJson.scripts = packageJson.scripts || {};
  packageJson.scripts.preinstall = 'bun .ranwawa/preinstall.ts';
  packageJson.scripts.prepare = 'git config core.hooksPath .ranwawa';
  packageJson.scripts['quality:changed'] =
    'node ./.along/preset/scripts/quality/run-changed.mjs';
  packageJson.scripts['quality:full'] =
    'node ./.along/preset/scripts/quality/run-full.mjs';

  fs.writeFileSync(
    packageJsonPath,
    formatWithBiome(
      'package.json',
      `${JSON.stringify(packageJson, null, 2)}\n`,
    ),
  );
  logger.success('已更新 package.json 质量脚本');
}

function updateGitignore(project: LoadedManagedProject) {
  const gitignorePath = path.join(project.projectDir, '.gitignore');
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf8')
    : '';
  const startMarker = '# begin along managed assets';
  const endMarker = '# end along managed assets';
  const managedBlock = buildManagedGitignoreBlock(project);
  const blockContent = `${startMarker}\n${managedBlock}\n${endMarker}`;
  const pattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`, 'm');
  const next = pattern.test(existing)
    ? existing.replace(pattern, blockContent)
    : `${existing.replace(/\s*$/, '')}\n\n${blockContent}\n`;

  fs.writeFileSync(gitignorePath, next);
  logger.success('已更新 .gitignore 受管目录放行规则');
}

function buildManagedGitignoreBlock(project: LoadedManagedProject): string {
  const lines = [
    '!.along/',
    '.along/*',
    '!.along/preset/',
    '!.along/preset/**',
  ];

  for (const editor of project.config.agent.editors) {
    lines.push(...buildEditorGitignoreRules(editor));
  }

  return lines.join('\n');
}

function cleanupLegacyPaths(project: LoadedManagedProject) {
  for (const relativePath of project.config.cleanupPaths || []) {
    const targetPath = path.join(project.projectDir, relativePath);

    if (!fs.existsSync(targetPath)) {
      continue;
    }

    fs.rmSync(targetPath, { recursive: true, force: true });
    logger.success(`已清理历史路径: ${relativePath}`);
  }
}

function cleanupManagedOutputRoots(project: LoadedManagedProject) {
  const pathsToReset = [
    '.along/preset',
    'prompts/along',
    'skills/along',
    '.ranwawa/pre-commit',
    '.ranwawa/commit-msg',
    '.ranwawa/preinstall.ts',
  ];

  for (const editor of project.config.agent.editors) {
    pathsToReset.push(
      EDITOR_PROMPT_DIRS[editor],
      path.dirname(EDITOR_SKILL_DIRS[editor]),
      EDITOR_SKILL_DIRS[editor],
    );
  }

  if (project.config.ci?.qualityGateAction?.enabled) {
    pathsToReset.push('.github/actions/along-quality-gate');
  }

  for (const relativePath of pathsToReset) {
    const targetPath = path.join(project.projectDir, relativePath);
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function writeManifest(
  project: LoadedManagedProject,
  generatedFiles: GeneratedFile[],
) {
  const manifestPath = path.join(
    project.projectDir,
    '.along/preset/manifest.json',
  );
  const manifest = {
    managedBy: '@ranwawa/along',
    projectId: project.config.id,
    displayName: project.config.displayName,
    presetVersion: project.config.presetVersion,
    generatedAt: new Date().toISOString(),
    files: generatedFiles.map((file) => ({
      path: file.path,
      sha256: hashContent(
        fs.readFileSync(path.join(project.projectDir, file.path), 'utf8'),
      ),
    })),
    packageJsonScripts: {
      preinstall: 'bun .ranwawa/preinstall.ts',
      prepare: 'git config core.hooksPath .ranwawa',
      'quality:changed': 'node ./.along/preset/scripts/quality/run-changed.mjs',
      'quality:full': 'node ./.along/preset/scripts/quality/run-full.mjs',
    },
  };

  ensureParentDir(manifestPath);
  fs.writeFileSync(
    manifestPath,
    formatWithBiome('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`),
  );
}

function formatGeneratedFiles(files: GeneratedFile[]): GeneratedFile[] {
  return files.map((file) => {
    if (!shouldFormatWithBiome(file.path)) {
      return file;
    }

    return {
      ...file,
      content: formatWithBiome(file.path, file.content),
    };
  });
}

function normalizeProjectConfigFile(project: LoadedManagedProject) {
  const configPath = project.configPath;
  const nextValue = project.rootConfig
    ? {
        ...project.rootConfig,
        distribution: project.config,
      }
    : project.config;

  fs.writeFileSync(
    configPath,
    formatWithBiome(
      path.basename(configPath),
      `${JSON.stringify(nextValue, null, 2)}\n`,
    ),
  );
}

function shouldFormatWithBiome(filePath: string): boolean {
  return filePath.endsWith('.json') || filePath.endsWith('.mjs');
}

function formatWithBiome(filePath: string, content: string): string {
  const result = spawnSync(
    'bunx',
    ['biome', 'format', '--stdin-file-path', filePath],
    {
      cwd: getWorkspaceRoot(),
      encoding: 'utf8',
      input: content,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    const details = result.stderr?.trim();
    throw new Error(
      details
        ? `格式化内容失败 (${filePath}): ${details}`
        : `格式化内容失败 (${filePath})`,
    );
  }

  return result.stdout;
}

function buildEditorGitignoreRules(editor: ManagedAgentEditor): string[] {
  const promptDir = EDITOR_PROMPT_DIRS[editor];
  const skillDir = EDITOR_SKILL_DIRS[editor];
  const promptParent = path.dirname(promptDir);
  const skillParent = path.dirname(skillDir);

  return [
    `!${promptParent}/`,
    `${promptParent}/*`,
    `!${promptDir}/`,
    `!${promptDir}/**`,
    `!${skillParent}/`,
    `!${skillDir}/`,
    `!${skillDir}/**`,
  ];
}
