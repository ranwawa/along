import fs from 'node:fs';
import path from 'node:path';
import consola from 'consola';
import { getPresetHooksDir } from './paths';

const HOOK_ASSET_DIR = getPresetHooksDir();

export function initCommitLint(cwd: string) {
  const log = consola.withTag('preset');

  const hooksDir = path.join(cwd, '.ranwawa');
  fs.mkdirSync(hooksDir, { recursive: true });
  const commitMsgPath = path.join(hooksDir, 'commit-msg');
  fs.copyFileSync(path.join(HOOK_ASSET_DIR, 'commit-msg'), commitMsgPath);
  fs.chmodSync(commitMsgPath, 0o755);
  log.success('已写入 .ranwawa/commit-msg');
}
