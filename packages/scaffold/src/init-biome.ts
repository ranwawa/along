import fs from 'fs';
import path from 'path';
import consola from 'consola';
import { $ } from 'bun';

const BIOME_CONFIG = {
  $schema: 'https://biomejs.dev/schemas/2.4.13/schema.json',
  extends: ['@ranwawa/biome-config/biome'],
};

const PRE_COMMIT_HOOK = `#!/bin/sh
bunx biome check --staged --write --no-errors-on-unmatched
`;

export async function initBiome() {
  const cwd = process.cwd();
  const log = consola.withTag('scaffold');

  log.start('开始初始化 Biome + Git Hooks...');

  const biomeJsonPath = path.join(cwd, 'biome.json');
  fs.writeFileSync(biomeJsonPath, JSON.stringify(BIOME_CONFIG, null, 2) + '\n');
  log.success('已写入 biome.json');

  const hooksDir = path.join(cwd, '.githooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const preCommitPath = path.join(hooksDir, 'pre-commit');
  fs.writeFileSync(preCommitPath, PRE_COMMIT_HOOK);
  fs.chmodSync(preCommitPath, 0o755);
  log.success('已写入 .githooks/pre-commit');

  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    log.warn('未找到 package.json，跳过依赖安装');
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts.prepare = 'git config core.hooksPath .githooks';
  pkg.scripts.format = pkg.scripts.format || 'biome format --write .';
  pkg.scripts.lint = pkg.scripts.lint || 'biome lint .';
  pkg.scripts.check = pkg.scripts.check || 'biome check --write .';
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  log.success('已更新 package.json scripts');

  log.start('安装依赖...');
  await $`bun add -d @biomejs/biome @ranwawa/biome-config`.quiet();
  log.success('已安装 @biomejs/biome 和 @ranwawa/biome-config');

  await $`git config core.hooksPath .githooks`.quiet();
  log.success('已配置 git hooks 路径');

  log.box('初始化完成！commit 时将自动运行 Biome 检查');
}
