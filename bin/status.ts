#!/usr/bin/env bun
/**
 * status.ts - ALONG 任务进度看板
 * 扫描 sessions 目录并展示所有活跃任务的状态与当前步骤
 */
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { config } from "./config";
import { calculate_runtime } from "./common";

function parseCurrentStep(todoPath: string): string {
  if (!fs.existsSync(todoPath)) return "未知";
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

  if (lastCheckedIndex === -1) {
    return items[0]?.replace(/- \[[ x/]\]\s*/, "") || "准备中";
  }
  
  if (lastCheckedIndex === items.length - 1) {
    return chalk.green("已完成");
  }

  return items[lastCheckedIndex + 1]?.replace(/- \[[ x/]\]\s*/, "") || "执行中";
}

async function main() {
  const sessionsDir = config.SESSION_DIR;
  if (!fs.existsSync(sessionsDir)) {
    console.log(chalk.yellow("暂无活跃任务记录"));
    return;
  }

  const files = fs
    .readdirSync(sessionsDir)
    .filter((f) => /^\d+-status\.json$/.test(f));
  if (files.length === 0) {
    console.log(chalk.yellow("暂无活跃任务记录"));
    return;
  }

  console.log("");
  console.log(chalk.bold.cyan("=========================================================================================="));
  console.log(chalk.bold.cyan(`  ${config.getLogTag().toUpperCase()} 任务实时进度看板`));
  console.log(chalk.bold.cyan("=========================================================================================="));
  console.log(
    chalk.bold(
      `${"ID".padEnd(8)} ${"类别".padEnd(8)} ${"状态".padEnd(10)} ${"运行时间".padEnd(10)} ${"当前步骤".padEnd(25)} ${"标题"}`
    )
  );
  console.log(chalk.dim("------------------------------------------------------------------------------------------"));

  for (const file of files) {
    try {
      const filePath = path.join(sessionsDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      
      const id = `#${data.issueNumber}`;
      const typeStr = "Issue";
      
      let statusStr = data.status || "unknown";
      if (statusStr === "running") statusStr = chalk.yellow("Running");
      else if (statusStr === "completed") statusStr = chalk.green("Done");
      else if (statusStr === "error") statusStr = chalk.red("Error");

      const runtime = calculate_runtime(data.startTime);
      
      // 解析当前步骤
      const todoFile = file.replace("-status.json", "-todo.md");
      const todoPath = path.join(sessionsDir, todoFile);
      const currentStep = data.currentStep || parseCurrentStep(todoPath);

      console.log(
        `${id.padEnd(8)} ${typeStr.padEnd(8)} ${statusStr.padEnd(20)} ${runtime.padEnd(10)} ${currentStep.padEnd(25)} ${data.title.substring(0, 30)}${data.title.length > 30 ? "..." : ""}`
      );
    } catch (e) {
      // 忽略单个文件解析错误
    }
  }

  console.log(chalk.dim("------------------------------------------------------------------------------------------"));
  console.log(chalk.dim(`共 ${files.length} 个任务记录`));
  console.log("");
}

main();
