import path from 'node:path';

export function getWorkspaceRoot(): string {
  return path.resolve(import.meta.dirname, '../../..');
}

export function getPresetAssetsRoot(): string {
  return path.resolve(import.meta.dirname, '../../preset-assets');
}

export function getBiomeSharedConfigPath(): string {
  return path.join(getPresetAssetsRoot(), 'biome/biome.shared.json');
}

export function getPresetGitignorePath(): string {
  return path.join(getPresetAssetsRoot(), 'gitignore/base.gitignore');
}

export function getPresetHooksDir(): string {
  return path.join(getPresetAssetsRoot(), 'hooks');
}

export function getPresetQualityDir(): string {
  return path.join(getPresetAssetsRoot(), 'quality');
}

export function getPresetPromptsDir(): string {
  return path.join(getPresetAssetsRoot(), 'prompts');
}

export function getPresetSkillsDir(): string {
  return path.join(getPresetAssetsRoot(), 'skills');
}

export function getPresetTemplatesDir(): string {
  return path.join(getPresetAssetsRoot(), 'templates');
}

export function getPresetTemplatePath(fileName: string): string {
  return path.join(getPresetTemplatesDir(), fileName);
}
