import fs from 'node:fs';
import path from 'node:path';
import consola from 'consola';
import { getPresetHooksDir } from './paths';

const HOOK_ASSET_DIR = getPresetHooksDir();

export function initBunOnly(cwd: string) {
  const log = consola.withTag('preset');

  const targetDir = path.join(cwd, '.ranwawa');
  fs.mkdirSync(targetDir, { recursive: true });
  const preinstallPath = path.join(targetDir, 'preinstall.ts');
  fs.copyFileSync(path.join(HOOK_ASSET_DIR, 'preinstall.ts'), preinstallPath);
  fs.chmodSync(preinstallPath, 0o755);
  log.success('已写入 .ranwawa/preinstall.ts');
}
