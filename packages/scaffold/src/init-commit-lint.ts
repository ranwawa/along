import consola from 'consola';
import fs from 'node:fs';
import path from 'node:path';

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

export function initCommitLint(cwd: string) {
  const log = consola.withTag('scaffold');

  const hooksDir = path.join(cwd, '.githooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const commitMsgPath = path.join(hooksDir, 'commit-msg');
  fs.writeFileSync(commitMsgPath, COMMIT_MSG_HOOK);
  fs.chmodSync(commitMsgPath, 0o755);
  log.success('已写入 .githooks/commit-msg');
}
