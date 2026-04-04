#!/usr/bin/env bun
/**
 * status.ts - ALONG 任务进度看板
 * 扫描 sessions 目录并展示所有活跃任务的状态与当前步骤
 */
import fs from "fs";
import chalk from "chalk";
import { config } from "./config";
import { calculate_runtime } from "./common";
import { execSync } from "child_process";
import { findAllSessions, SessionPathManager } from "./session-paths";

interface StepProgress {
  completed: number;
  total: number;
  stepText: string;
}

function parseTodoProgress(todoPath: string): StepProgress | null {
  if (!fs.existsSync(todoPath)) return null;
  const content = fs.readFileSync(todoPath, "utf-8");
  const lines = content.split("\n");

  let lastCheckedIndex = -1;
  const items: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("- [ ]") || line.startsWith("- [x]") || line.startsWith("- [/]")) {
      items.push(line);
      if (line.startsWith("- [x]")) {
        lastCheckedIndex = items.length - 1;
      }
    }
  }

  const total = items.length;
  const completed = lastCheckedIndex + 1;

  if (lastCheckedIndex === -1) {
    const text = items[0]?.replace(/- \[[ x/]\]\s*/, "") || "准备中";
    return { completed: 0, total, stepText: text };
  }

  if (lastCheckedIndex === items.length - 1) {
    return { completed: total, total, stepText: chalk.green("已完成") };
  }

  const text = items[lastCheckedIndex + 1]?.replace(/- \[[ x/]\]\s*/, "") || "执行中";
  return { completed, total, stepText: text };
}

function formatStepWithProgress(progress: StepProgress | null, overrideText?: string): string {
  if (!progress) return overrideText || "未知";
  const prefix = `${progress.completed}/${progress.total}`;
  const text = overrideText || progress.stepText;
  return `${prefix} ${text}`;
}

function getActiveTmuxWindows(): Set<string> {
  try {
    const output = execSync("tmux list-windows -a -F '#{window_name}'", {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return new Set(output.trim().split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

export async function printStatusBoard() {
  const allSessions = findAllSessions();
  if (allSessions.length === 0) {
    console.log(chalk.yellow("暂无活跃任务记录"));
    return;
  }

  console.log("");
  console.log(chalk.bold.cyan("=========================================================================================="));
  console.log(chalk.bold.cyan(`  ${config.getLogTag().toUpperCase()} 任务实时进度看板`));
  console.log(chalk.bold.cyan("=========================================================================================="));
  console.log(
    chalk.bold(
      `${"ID".padEnd(8)} ${"类别".padEnd(8)} ${"状态".padEnd(12)} ${"运行时间".padEnd(10)} ${"当前步骤".padEnd(25)} ${"标题"}`
    )
  );
  console.log(chalk.dim("------------------------------------------------------------------------------------------"));

  const activeWindows = getActiveTmuxWindows();

  for (const session of allSessions) {
    try {
      const data = JSON.parse(fs.readFileSync(session.statusFile, "utf-8"));

      const id = `#${data.issueNumber}`;
      const typeStr = "Issue";

      let statusStr = data.status || "unknown";
      if (statusStr === "running") {
        const tmuxWindow = `pi-${data.issueNumber}`;
        if (activeWindows.has(tmuxWindow)) {
          statusStr = chalk.yellow("Running");
        } else {
          statusStr = chalk.gray("Stopped");
        }
      }
      else if (statusStr === "completed") statusStr = chalk.green("Done");
      else if (statusStr === "error") statusStr = chalk.red("Error");
      else if (statusStr === "crashed") statusStr = chalk.red("Crashed");

      const runtime = calculate_runtime(data.startTime);

      // 解析当前步骤
      const paths = new SessionPathManager(session.owner, session.repo, session.issueNumber);
      const todoPath = paths.getTodoFile();
      const progress = parseTodoProgress(todoPath);
      const currentStep = formatStepWithProgress(progress, data.currentStep || undefined);

      console.log(
        `${id.padEnd(8)} ${typeStr.padEnd(8)} ${statusStr.padEnd(20)} ${runtime.padEnd(10)} ${currentStep.padEnd(25)} ${data.title.substring(0, 30)}${data.title.length > 30 ? "..." : ""}`
      );
    } catch (e) {
      // 忽略单个文件解析错误
    }
  }

  console.log(chalk.dim("------------------------------------------------------------------------------------------"));
  console.log(chalk.dim(`共 ${allSessions.length} 个任务记录`));

  // 显示错误详情
  const errorSessions: any[] = [];
  for (const session of allSessions) {
    try {
      const data = JSON.parse(fs.readFileSync(session.statusFile, "utf-8"));
      if (data.status === "error" || data.status === "crashed") {
        errorSessions.push(data);
      }
    } catch (e) {
      // 忽略
    }
  }

  if (errorSessions.length > 0) {
    console.log("");
    console.log(chalk.bold.red("=========================================================================================="));
    console.log(chalk.bold.red("  错误/崩溃任务详情"));
    console.log(chalk.bold.red("=========================================================================================="));
    for (const session of errorSessions) {
      console.log("");
      console.log(chalk.bold(`Issue #${session.issueNumber}: ${session.title}`));
      console.log(chalk.red(`  状态: ${session.status}`));
      if (session.errorMessage) {
        console.log(chalk.red(`  错误: ${session.errorMessage}`));
      }
      if (session.exitCode !== undefined) {
        console.log(chalk.yellow(`  退出码: ${session.exitCode}`));
      }
      if (session.lastUpdate) {
        console.log(chalk.dim(`  最后更新: ${session.lastUpdate}`));
      }
    }
    console.log("");
    console.log(chalk.dim("  详细日志请查看: along logs list"));
  }

  console.log("");
}

// 仅在直接执行时运行 CLI
if (import.meta.main) {
  printStatusBoard();
}
