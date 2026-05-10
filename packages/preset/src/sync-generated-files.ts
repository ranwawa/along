import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectBiomeFiles,
  collectHookFiles,
  collectPromptFiles,
  collectQualityEngineFiles,
  collectSkillFiles,
  renderQualityConfig,
} from './collect-assets';
import { readText, writeGeneratedFiles } from './file-utils';
import { getPresetGitignorePath, getWorkspaceRoot } from './paths';
import {
  CONFIG_FILE_NAME,
  normalizeManagedProjectConfig,
} from './project-config';
import { renderAgentsDoc, renderQualityGateAction } from './render-docs';
import type { GeneratedFile, LoadedManagedProject } from './types';

const GIT_HOOKS_DIR = '.along/git-hooks';
const PREINSTALL_SCRIPT = `${GIT_HOOKS_DIR}/preinstall.ts`;
const QUALITY_CHANGED_SCRIPT =
  'bun ./.along/preset/scripts/quality/run-changed.mjs';
const QUALITY_FULL_SCRIPT = 'bun ./.along/preset/scripts/quality/run-full.mjs';

export function buildExpectedFiles(
  project: LoadedManagedProject,
): GeneratedFile[] {
  const assetFiles = buildGeneratedFiles(project);
  const formattedFiles = prepareGeneratedFiles([
    ...assetFiles,
    buildPackageJsonFile(project),
    buildProjectConfigFile(project),
    buildGitignoreFile(project),
  ]);

  return dedupeGeneratedFiles(formattedFiles);
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

  if (project.resolved.ci?.qualityGateAction?.enabled) {
    files.push({
      path: '.github/actions/along-quality-gate/action.yml',
      content: renderQualityGateAction(project),
    });
  }

  return files;
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
    runBiomeGeneratedCheck(tempDir, files);

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
}

function runBiomeGeneratedCheck(tempDir: string, files: GeneratedFile[]) {
  const configPath = path.join(tempDir, '.along/preset/biome.shared.json');
  const args = [
    'biome',
    'check',
    '--write',
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
