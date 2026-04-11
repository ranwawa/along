#!/usr/bin/env bun
/**
 * session-finalize.ts - Agent 完成后更新 session 状态
 *
 * Usage: bun bin/session-finalize.ts <owner> <repo> <issueNumber> <exitCode> [logFile]
 *
 * 轻量脚本，供 tmux shell 在 agent 退出后调用。
 * 根据 exitCode 将 running 状态更新为 completed 或 crashed。
 */
import fs from "fs";
import { readSession, upsertSession } from "./db";

const [owner, repo, issueNumberStr, exitCodeStr, logFile] = process.argv.slice(2);

if (!owner || !repo || !issueNumberStr || !exitCodeStr) {
  process.exit(1);
}

const issueNumber = Number(issueNumberStr);
const exitCode = Number(exitCodeStr) || 0;

try {
  const res = readSession(owner, repo, issueNumber);
  if (!res.success || !res.data) process.exit(0);
  const session = res.data;
  if (session.status !== "running") process.exit(0);

  const now = new Date().toISOString();
  const update: Record<string, any> = {
    status: exitCode === 0 ? "completed" : "crashed",
    endTime: now,
    lastUpdate: now,
  };

  if (exitCode !== 0) {
    update.errorMessage = `Agent 退出码: ${exitCode}`;
    update.exitCode = exitCode;

    // 读取日志文件最后 20 行作为 crashLog
    if (logFile && fs.existsSync(logFile)) {
      try {
        const lines = fs.readFileSync(logFile, "utf-8").split("\n");
        update.crashLog = lines.slice(-20).join("\n");
      } catch {}
    }
  }

  upsertSession(owner, repo, issueNumber, update);
} catch {
  // 静默失败
  process.exit(0);
}
