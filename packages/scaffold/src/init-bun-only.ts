import consola from 'consola';
import fs from 'node:fs';
import path from 'node:path';

const PREINSTALL_SCRIPT = `#!/usr/bin/env bun
if (!process.env.npm_config_user_agent?.includes("bun")) {
  console.error("\\x1b[31m%s\\x1b[0m", "错误: 必须使用 Bun 进行包管理。");
  console.error("\\x1b[31m%s\\x1b[0m", "请运行 \\\`bun install\\\` 而不是 npm/yarn/pnpm。");
  process.exit(1);
}
`;

export function initBunOnly(cwd: string) {
  const log = consola.withTag('scaffold');

  const preinstallPath = path.join(cwd, 'bin', 'preinstall.ts');
  fs.mkdirSync(path.join(cwd, 'bin'), { recursive: true });
  fs.writeFileSync(preinstallPath, PREINSTALL_SCRIPT);
  fs.chmodSync(preinstallPath, 0o755);
  log.success('已写入 bin/preinstall.ts');
}
