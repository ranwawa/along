import path from 'node:path';
import { EDITOR_PROMPT_DIRS, EDITOR_SKILL_DIRS } from './editor-targets';
import { collectFilesRecursively, readText } from './file-utils';
import {
  getBiomeSharedConfigPath,
  getPresetHooksDir,
  getPresetPromptsDir,
  getPresetQualityDir,
  getPresetSkillsDir,
} from './paths';
import type {
  GeneratedFile,
  LoadedManagedProject,
  ManagedAgentEditor,
} from './types';

export function renderQualityConfig(project: LoadedManagedProject): string {
  return `${JSON.stringify(project.resolved.quality, null, 2)}\n`;
}

export function collectBiomeFiles(): GeneratedFile[] {
  return [
    {
      path: '.along/preset/biome.shared.json',
      content: readText(getBiomeSharedConfigPath()),
    },
    {
      path: 'biome.json',
      content: `${JSON.stringify(
        {
          $schema: 'https://biomejs.dev/schemas/2.4.13/schema.json',
          extends: ['./.along/preset/biome.shared.json'],
          files: {
            ignoreUnknown: true,
            includes: ['**', '!!.along', '!!.claude', '!!.codex', '!!**/dist'],
          },
          vcs: {
            enabled: true,
            clientKind: 'git',
            useIgnoreFile: true,
          },
        },
        null,
        2,
      )}\n`,
    },
  ];
}

export function collectQualityEngineFiles(): GeneratedFile[] {
  const sourceRoot = getPresetQualityDir();

  return collectFilesRecursively(sourceRoot).map((absolutePath) => ({
    path: path.join(
      '.along/preset/scripts/quality',
      path.basename(absolutePath),
    ),
    content: readText(absolutePath),
  }));
}

export function collectHookFiles(): GeneratedFile[] {
  const sourceRoot = getPresetHooksDir();

  return collectFilesRecursively(sourceRoot).map((absolutePath) => ({
    path: path.join('.along/git-hooks', path.basename(absolutePath)),
    content: readText(absolutePath),
  }));
}

export function collectPromptFiles(
  project: LoadedManagedProject,
): GeneratedFile[] {
  const sourceRoot = getPresetPromptsDir();

  return collectFilesRecursively(sourceRoot).flatMap((absolutePath) => {
    const fileName = path.basename(absolutePath);
    const content = readText(absolutePath);
    const outputs: GeneratedFile[] = [
      {
        path: path.join('prompts/along', fileName),
        content,
      },
    ];

    for (const editor of project.resolved.agent.editors) {
      outputs.push({
        path: path.join(getEditorPromptTargetDir(editor), fileName),
        content,
      });
    }

    return outputs;
  });
}

export function collectSkillFiles(
  project: LoadedManagedProject,
): GeneratedFile[] {
  const sourceRoot = getPresetSkillsDir();

  return collectFilesRecursively(sourceRoot).flatMap((absolutePath) => {
    const relativePath = path.relative(sourceRoot, absolutePath);
    const content = readText(absolutePath);
    const outputs: GeneratedFile[] = [
      {
        path: path.join('skills/along', relativePath),
        content,
      },
    ];

    for (const editor of project.resolved.agent.editors) {
      outputs.push({
        path: path.join(getEditorSkillTargetDir(editor), relativePath),
        content,
      });
    }

    return outputs;
  });
}

function getEditorPromptTargetDir(editor: ManagedAgentEditor): string {
  return EDITOR_PROMPT_DIRS[editor];
}

function getEditorSkillTargetDir(editor: ManagedAgentEditor): string {
  return EDITOR_SKILL_DIRS[editor];
}
