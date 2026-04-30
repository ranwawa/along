import path from 'node:path';

export function getWorkspaceRoot(): string {
  return path.resolve(import.meta.dirname, '../../..');
}

export function getPresetAssetsRoot(): string {
  return path.resolve(import.meta.dirname, '../../preset-assets');
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
