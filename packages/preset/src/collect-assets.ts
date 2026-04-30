import path from 'node:path';
import { EDITOR_PROMPT_DIRS, EDITOR_SKILL_DIRS } from './editor-targets';
import { collectFilesRecursively, readText } from './file-utils';
import {
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
  return `${JSON.stringify(project.config.quality, null, 2)}\n`;
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
    path: path.join('.ranwawa', path.basename(absolutePath)),
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

    for (const editor of project.config.agent.editors) {
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

    for (const editor of project.config.agent.editors) {
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
