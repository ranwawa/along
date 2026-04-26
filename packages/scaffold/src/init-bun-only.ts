import consola from 'consola';
import fs from 'node:fs';
import path from 'node:path';

const TEMPLATE_DIR = path.join(import.meta.dirname, 'templates');

export function initBunOnly(cwd: string) {
  const log = consola.withTag('scaffold');

  const targetDir = path.join(cwd, '.ranwawa');
  fs.mkdirSync(targetDir, { recursive: true });
  const preinstallPath = path.join(targetDir, 'preinstall.ts');
  fs.copyFileSync(path.join(TEMPLATE_DIR, 'preinstall.ts'), preinstallPath);
  fs.chmodSync(preinstallPath, 0o755);
  log.success('已写入 .ranwawa/preinstall.ts');
}
