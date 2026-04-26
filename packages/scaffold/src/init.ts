import { $ } from 'bun';
import consola from 'consola';
import { initBiome } from './init-biome';
import { initBunOnly } from './init-bun-only';
import { initCommitLint } from './init-commit-lint';
import { initScripts } from './init-scripts';
import { preflight } from './preflight';

export async function init() {
  const cwd = process.cwd();
  const log = consola.withTag('scaffold');

  preflight(cwd);

  log.start('开始初始化项目工程规范...');

  await initBiome(cwd);
  initCommitLint(cwd);
  initBunOnly(cwd);
  initScripts(cwd);

  await $`git config core.hooksPath .ranwawa`.quiet();
  log.success('已配置 git hooks 路径');

  log.box('初始化完成！强制 Bun 包管理 + Biome 检查 + 提交信息格式校验');
}
