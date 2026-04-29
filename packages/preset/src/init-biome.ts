import fs from 'node:fs';
import path from 'node:path';
import { $ } from 'bun';
import consola from 'consola';
import { getPresetHooksDir } from './paths';

const BIOME_CONFIG = {
  $schema: 'https://biomejs.dev/schemas/2.4.13/schema.json',
  extends: ['@ranwawa/biome-config/biome'],
};

const HOOK_ASSET_DIR = getPresetHooksDir();

export async function initBiome(cwd: string) {
  const log = consola.withTag('preset');

  const biomeJsonPath = path.join(cwd, 'biome.json');
  fs.writeFileSync(biomeJsonPath, `${JSON.stringify(BIOME_CONFIG, null, 2)}\n`);
  log.success('已写入 biome.json');

  const hooksDir = path.join(cwd, '.ranwawa');
  fs.mkdirSync(hooksDir, { recursive: true });
  const preCommitPath = path.join(hooksDir, 'pre-commit');
  fs.copyFileSync(path.join(HOOK_ASSET_DIR, 'pre-commit'), preCommitPath);
  fs.chmodSync(preCommitPath, 0o755);
  log.success('已写入 .ranwawa/pre-commit');

  log.start('安装依赖...');
  await $`bun add -d @biomejs/biome @ranwawa/biome-config`.quiet();
  log.success('已安装 @biomejs/biome 和 @ranwawa/biome-config');
}
