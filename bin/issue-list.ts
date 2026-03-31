#!/usr/bin/env bun
import { $ } from "bun";
import {
  checkGitRepo,
  get_repo_root,
  calculate_runtime,
  logger,
  log_error,
} from "./common";
import { config } from "./config";
import chalk from "chalk";
import path from "path";
import fs from "fs";

import { Command } from "commander";

function printHeader() {
  logger.log("");
  logger.log(chalk.blue("╔══════════════════════════════════════════════════════════════════╗"));
  logger.log(chalk.blue("║                 Issue 工作空间状态列表                            ║"));
  logger.log(chalk.blue("╚══════════════════════════════════════════════════════════════════╝"));
  logger.info("");
}

function getStatusInfo(status: string) {
  if (status === "running") return { icon: "▶", color: chalk.cyan, label: "running" };
  if (status === "completed") return { icon: "✓", color: chalk.green, label: "completed" };
  if (status === "error") return { icon: "✗", color: chalk.red, label: "error" };
  return { icon: "?", color: chalk.dim, label: "unknown" };
}

function printIssueRow(issueNumber: string, data: any, worktreesDir: string) {
  const { icon, color, label } = getStatusInfo(data.status || "unknown");
  const runtime = data.startTime ? calculate_runtime(data.startTime) : "未知";
  const title = (data.title || "").substring(0, 40);
  const worktreePath = path.join(worktreesDir, `${issueNumber}`);
  const worktreeExists = fs.existsSync(worktreePath) ? chalk.green("✓") : chalk.red("✗");

  logger.log(`  [${icon}] #${issueNumber.padStart(3)}  ${color(label.padEnd(9))}  ${chalk.dim(runtime.padEnd(6))}  ${title}`);
  logger.log(`       分支: ${chalk.dim((data.branchName || "").padEnd(30))}  worktree: ${worktreeExists}\n`);
}

function shouldShow(status: string, options: any) {
  if (options.running && status !== "running") return false;
  if (options.completed && status !== "completed") return false;
  if (options.error && status !== "error") return false;
  return true;
}

async function main() {
  const program = new Command();
  program
    .name("issue-list")
    .description("查看当前所有 Issue 工作空间的状态列表")
    .option("-a, --all", "显示所有 (默认)", true)
    .option("-r, --running", "仅显示运行中")
    .option("-c, --completed", "仅显示已完成")
    .option("-e, --error", "仅显示错误")
    .parse();

  const options = program.opts();
  const gitResult = await checkGitRepo();
  if (!gitResult.success) {
    log_error(gitResult.error);
    process.exit(1);
  }

  const repoRoot = await get_repo_root();
  const sessionsDir = config.SESSION_DIR;
  const worktreesDir = config.WORKTREE_DIR;

  if (!fs.existsSync(sessionsDir)) {
    logger.info("暂无 Issue 工作空间");
    process.exit(0);
  }

  printHeader();

  let stats = { total: 0, running: 0, completed: 0, error: 0 };
  const files = fs.readdirSync(sessionsDir).filter(f => /^\d+-status\.json$/.test(f));

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), "utf-8"));
    if (!shouldShow(data.status, options)) continue;

    const issueNumber = file.match(/(\d+)-status\.json/)![1];
    printIssueRow(issueNumber, data, worktreesDir);

    stats.total++;
    if (data.status === "running") stats.running++;
    else if (data.status === "completed") stats.completed++;
    else if (data.status === "error") stats.error++;
  }

  logger.log(chalk.blue("═══════════════════════════════════════════════════════════════════"));
  logger.log(`总计: ${chalk.bold(stats.total)}  (运行中: ${chalk.green(stats.running)}, 已完成: ${chalk.blue(stats.completed)}, error: ${chalk.red(stats.error)})`);
  logger.log(chalk.blue("═══════════════════════════════════════════════════════════════════"));
  logger.info("\n使用方式: issue-list [--running | --completed | --error]");
}

main();
