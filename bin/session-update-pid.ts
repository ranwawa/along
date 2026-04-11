#!/usr/bin/env bun
/**
 * session-update-pid.ts - 在 tmux 中更新 session 的 PID
 *
 * Usage: bun bin/session-update-pid.ts <owner> <repo> <issueNumber> <pid>
 *
 * 轻量脚本，供 tmux shell 启动时调用，将 shell PID 写入数据库。
 */
import { upsertSession } from "./db";

const [owner, repo, issueNumberStr, pidStr] = process.argv.slice(2);

if (!owner || !repo || !issueNumberStr || !pidStr) {
  process.exit(1);
}

try {
  const res = upsertSession(owner, repo, Number(issueNumberStr), {
    pid: Number(pidStr),
  });
  if (!res.success) {
     // 如果更新失败，至少在终端能看到（虽然 tmux 启动脚本可能不会显示）
     console.error(`更新 PID 失败: ${res.error}`);
  }
} catch {
  // 静默失败，不影响 agent 启动
  process.exit(0);
}
