#!/usr/bin/env bun
/**
 * session-finalize.ts - Agent 完成后更新 session 状态
 *
 * Usage: bun bin/session-finalize.ts <owner> <repo> <issueNumber> <phase> <exitCode> [logFile]
 *
 * 轻量脚本，供 tmux shell 在 agent 退出后调用。
 * 根据 phase + exitCode 驱动状态机，而不是直接写死 completed。
 */
import fs from "fs";
import { readSession, upsertSession } from "./db";
import { applySessionStateEvent } from "./session-state-machine";

const [owner, repo, issueNumberStr, phase, exitCodeStr, logFile] = process.argv.slice(2);

if (!owner || !repo || !issueNumberStr || !phase || !exitCodeStr) {
  process.exit(1);
}

const issueNumber = Number(issueNumberStr);
const exitCode = Number(exitCodeStr) || 0;

try {
  const res = readSession(owner, repo, issueNumber);
  if (!res.success || !res.data) process.exit(0);
  const session = res.data;

  let update: Record<string, any>;

  if (exitCode === 0) {
    update = applySessionStateEvent(session, {
      type: "AGENT_EXITED_SUCCESS",
      phase: phase as "phase1" | "phase2",
    }).patch;
  } else {
    let crashLog: string | undefined;

    if (logFile && fs.existsSync(logFile)) {
      try {
        const lines = fs.readFileSync(logFile, "utf-8").split("\n");
        crashLog = lines.slice(-20).join("\n");
      } catch {}
    }

    update = applySessionStateEvent(session, {
      type: "AGENT_EXITED_FAILURE",
      message: `Agent 退出码: ${exitCode}`,
      exitCode,
      crashLog,
    }).patch;
  }

  upsertSession(owner, repo, issueNumber, {
    ...update,
    lastUpdate: new Date().toISOString(),
  });
} catch {
  // 静默失败
  process.exit(0);
}
