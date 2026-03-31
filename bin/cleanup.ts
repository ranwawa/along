#!/usr/bin/env bun
import { $ } from "bun";
import {
  log_info,
  log_error,
  log_warn,
  log_success,
  check_process_running,
  iso_timestamp,
  Result,
  success,
  failure,
} from "./common";
import { config } from "./config";
import path from "path";
import fs from "fs";

import { Command } from "commander";

async function checkRunningSession(statusFile: string, issueNumber: string, force: boolean): Promise<Result<null>> {
  if (!fs.existsSync(statusFile)) return success(null);
  const data = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
  if (data.status !== "running") return success(null);

  const pid = data.pid || "";
  if (!pid || !(await check_process_running(pid))) return success(null);

  const tag = config.getLogTag();
  if (!force) {
    return failure(`Issue #${issueNumber} 仍在运行中 (PID: ${pid})\n如需强制清理，请使用: ${tag}-cleanup ${issueNumber} --force`);
  }

  log_warn(`强制终止进程 PID: ${pid}`);
  try { process.kill(Number(pid), 9); } catch {}
  return success(null);
}

async function cleanupWorktree(worktreePath: string) {
  const worktreeList = await $`git worktree list`.text();
  if (!fs.existsSync(worktreePath) && !worktreeList.includes(worktreePath)) {
    log_info(`worktree 目录不存在: ${worktreePath}`);
    return;
  }

  log_info(`删除 worktree: ${worktreePath}`);
  try {
    await $`git worktree remove ${worktreePath} --force`.quiet();
  } catch {
    log_warn("git worktree remove 失败，尝试手动删除...");
    await $`rm -rf ${worktreePath}`;
  }
}

async function cleanupBranch(statusFile: string) {
  if (!fs.existsSync(statusFile)) return;
  const data = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
  const branchName = data.branchName || "";
  if (!branchName) return;

  const branches = await $`git branch --list ${branchName}`.text();
  if (branches.includes(branchName)) {
    log_info(`删除本地分支: ${branchName}`);
    await $`git branch -D ${branchName}`.quiet().nothrow();
  }
}

async function archiveSession(statusFile: string, todoFile: string, issueNumber: string, force: boolean) {
  const archiveDir = path.join(path.dirname(statusFile), "archive");
  await $`mkdir -p ${archiveDir}`;
  const timestamp = Math.floor(Date.now() / 1000);

  if (fs.existsSync(statusFile)) {
    const data = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
    data.cleanupTime = iso_timestamp();
    data.cleanupReason = force ? "force" : "normal";
    const archiveFile = path.join(archiveDir, `${issueNumber}-${timestamp}.json`);
    await Bun.write(archiveFile, JSON.stringify(data, null, 2));
    fs.unlinkSync(statusFile);
    log_info(`状态文件已归档: ${archiveFile}`);
  }

  if (fs.existsSync(todoFile)) {
    const archiveTodo = path.join(archiveDir, `${issueNumber}-todo-${timestamp}.md`);
    await $`mv ${todoFile} ${archiveTodo}`;
    log_info(`追踪文件已归档: ${archiveTodo}`);
  }
}

async function main() {
  const program = new Command();
  program
    .name("issue-cleanup")
    .description("清理 Issue 处理工作空间和状态")
    .argument("<issue-number>", "Issue 编号")
    .option("-f, --force", "强制清理，即使进程正在运行", false)
    .parse();

  const [issueNumber] = program.args;
  const { force } = program.opts();

  const statusFile = path.join(config.SESSION_DIR, `${issueNumber}-status.json`);
  const worktreePath = path.join(config.WORKTREE_DIR, `${issueNumber}`);
  const todoFile = path.join(config.SESSION_DIR, `${issueNumber}-todo.md`);

  log_info(`清理 Issue #${issueNumber}...`);

  const runResult = await checkRunningSession(statusFile, issueNumber, force);
  if (!runResult.success) {
    log_error(runResult.error);
    process.exit(1);
  }

  await cleanupWorktree(worktreePath);
  await cleanupBranch(statusFile);
  await archiveSession(statusFile, todoFile, issueNumber, force);

  log_success(`Issue #${issueNumber} 清理完成`);
}

main();
