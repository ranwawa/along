import { $ } from 'bun';
import consola from 'consola';
import fs from 'node:fs';
import path from 'node:path';

const BIOME_CONFIG = {
  $schema: 'https://biomejs.dev/schemas/2.4.13/schema.json',
  extends: ['@ranwawa/biome-config/biome'],
};

const PRE_COMMIT_HOOK = `#!/bin/sh
bunx biome check --staged --write --no-errors-on-unmatched
`;

export async function initBiome(cwd: string) {
  const log = consola.withTag('scaffold');

  const biomeJsonPath = path.join(cwd, 'biome.json');
  fs.writeFileSync(biomeJsonPath, `${JSON.stringify(BIOME_CONFIG, null, 2)}\n`);
  log.success('已写入 biome.json');

  const hooksDir = path.join(cwd, '.githooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const preCommitPath = path.join(hooksDir, 'pre-commit');
  fs.writeFileSync(preCommitPath, PRE_COMMIT_HOOK);
  fs.chmodSync(preCommitPath, 0o755);
  log.success('已写入 .githooks/pre-commit');

  log.start('安装依赖...');
  await $`bun add -d @biomejs/biome @ranwawa/biome-config`.quiet();
  log.success('已安装 @biomejs/biome 和 @ranwawa/biome-config');
}
