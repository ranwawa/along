import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

export function getWorkspaceRoot(): string {
  return path.resolve(import.meta.dirname, '../../..');
}

export function getPresetAssetsRoot(): string {
  return path.resolve(import.meta.dirname, '../../preset-assets');
}

export function getBiomeSharedConfigPath(): string {
  return require.resolve('@ranwawa/biome-config/biome');
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
