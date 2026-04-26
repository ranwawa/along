import { $ } from 'bun';
import consola from 'consola';
import fs from 'fs';
import path from 'path';

const BIOME_CONFIG = {
  $schema: 'https://biomejs.dev/schemas/2.4.13/schema.json',
  extends: ['@ranwawa/biome-config/biome'],
};

const PRE_COMMIT_HOOK = `#!/bin/sh
bunx biome check --staged --write --no-errors-on-unmatched
`;

const PREINSTALL_SCRIPT = `#!/usr/bin/env bun
if (!process.env.npm_config_user_agent?.includes("bun")) {
  console.error("\\x1b[31m%s\\x1b[0m", "错误: 必须使用 Bun 进行包管理。");
  console.error("\\x1b[31m%s\\x1b[0m", "请运行 \\\`bun install\\\` 而不是 npm/yarn/pnpm。");
  process.exit(1);
}
`;

const COMMIT_MSG_HOOK = `#!/bin/sh
msg=$(head -1 "$1")

if ! echo "$msg" | grep -qE '^(feat|fix|docs|style|refactor|perf|test|chore|ci)(\\(.+\\))?: .+'; then
  echo "错误: commit message 不符合 Conventional Commits 规范"
  echo ""
  echo "正确格式: <type>(<scope>): <description>"
  echo "示例:     feat(auth): 新增登录功能"
  echo ""
  echo "允许的 type: feat, fix, docs, style, refactor, perf, test, chore, ci"
  exit 1
fi
`;

export async function init() {
  const cwd = process.cwd();
  const log = consola.withTag('scaffold');

  log.start('开始初始化项目工程规范...');

  const biomeJsonPath = path.join(cwd, 'biome.json');
  fs.writeFileSync(biomeJsonPath, JSON.stringify(BIOME_CONFIG, null, 2) + '\n');
  log.success('已写入 biome.json');

  const hooksDir = path.join(cwd, '.githooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const preCommitPath = path.join(hooksDir, 'pre-commit');
  fs.writeFileSync(preCommitPath, PRE_COMMIT_HOOK);
  fs.chmodSync(preCommitPath, 0o755);
  log.success('已写入 .githooks/pre-commit');

  const commitMsgPath = path.join(hooksDir, 'commit-msg');
  fs.writeFileSync(commitMsgPath, COMMIT_MSG_HOOK);
  fs.chmodSync(commitMsgPath, 0o755);
  log.success('已写入 .githooks/commit-msg');

  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    log.warn('未找到 package.json，跳过依赖安装');
    return;
  }

  const preinstallPath = path.join(cwd, 'bin', 'preinstall.ts');
  fs.mkdirSync(path.join(cwd, 'bin'), { recursive: true });
  fs.writeFileSync(preinstallPath, PREINSTALL_SCRIPT);
  fs.chmodSync(preinstallPath, 0o755);
  log.success('已写入 bin/preinstall.ts');

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts.preinstall = 'bun bin/preinstall.ts';
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

  log.box('初始化完成！强制 Bun 包管理 + Biome 检查 + 提交信息格式校验');
}
