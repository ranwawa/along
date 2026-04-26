import fs from 'node:fs';
import path from 'node:path';
import consola from 'consola';

const TEMPLATE_DIR = path.join(import.meta.dirname, 'templates');

export function initCommitLint(cwd: string) {
  const log = consola.withTag('scaffold');

  const hooksDir = path.join(cwd, '.ranwawa');
  fs.mkdirSync(hooksDir, { recursive: true });
  const commitMsgPath = path.join(hooksDir, 'commit-msg');
  fs.copyFileSync(path.join(TEMPLATE_DIR, 'commit-msg'), commitMsgPath);
  fs.chmodSync(commitMsgPath, 0o755);
  log.success('已写入 .ranwawa/commit-msg');
}
