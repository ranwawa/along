import consola from 'consola';
import fs from 'node:fs';
import path from 'node:path';

export function preflight(cwd: string) {
  const log = consola.withTag('scaffold');

  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    log.error('当前目录未找到 package.json，请先运行 bun init');
    process.exit(1);
  }

  const gitDir = path.join(cwd, '.git');
  if (!fs.existsSync(gitDir)) {
    log.error('当前目录不是 Git 仓库，请先运行 git init');
    process.exit(1);
  }
}
