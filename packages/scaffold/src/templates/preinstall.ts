#!/usr/bin/env bun
if (!process.env.npm_config_user_agent?.includes("bun")) {
  console.error("\x1b[31m%s\x1b[0m", "错误: 必须使用 Bun 进行包管理。");
  console.error("\x1b[31m%s\x1b[0m", "请运行 `bun install` 而不是 npm/yarn/pnpm。");
  process.exit(1);
}
