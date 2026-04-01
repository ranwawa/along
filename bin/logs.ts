#!/usr/bin/env bun
/**
 * logs.ts - 查看 Agent 运行日志的辅助工具
 */

import path from "path";
import fs from "fs";
import { logger, log_info, log_success, log_error } from "./common";
import { config } from "./config";
import { Command } from "commander";
import chalk from "chalk";

async function listLogs(num?: string, limit: number = 10) {
  if (!fs.existsSync(config.LOG_DIR)) {
    log_error("日志目录不存在，暂无日志");
    return;
  }

  let files = fs
    .readdirSync(config.LOG_DIR)
    .filter((f) => f.endsWith(".log"))
    .map((f) => {
      const filePath = path.join(config.LOG_DIR, f);
      const stat = fs.statSync(filePath);
      return { name: f, path: filePath, mtime: stat.mtime, size: stat.size };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  if (num) {
    files = files.filter((f) => f.name.includes(`${num}-`));
  }

  if (files.length === 0) {
    log_info(num ? `Issue #${num} 暂无日志` : "暂无日志");
    return;
  }

  log_success(`找到 ${files.length} 个日志文件`);
  console.log("");

  files.slice(0, limit).forEach((file, idx) => {
    const timeStr = file.mtime.toLocaleString("zh-CN");
    const sizeKb = (file.size / 1024).toFixed(1);
    console.log(
      `${chalk.cyan(idx + 1 + ".")} ${chalk.bold(file.name)}`,
    );
    console.log(`   时间: ${timeStr} | 大小: ${sizeKb} KB`);
    console.log(`   路径: ${chalk.dim(file.path)}`);
    console.log("");
  });

  if (files.length > limit) {
    log_info(`... 还有 ${files.length - limit} 个日志文件未显示`);
  }
}

async function showLog(filePath: string, lines: number = 100) {
  if (!fs.existsSync(filePath)) {
    log_error(`日志文件不存在: ${filePath}`);
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const allLines = content.split("\n");
  
  console.log(chalk.cyan("=".repeat(60)));
  console.log(chalk.bold(`日志文件: ${path.basename(filePath)}`));
  console.log(chalk.cyan("=".repeat(60)));
  console.log("");

  if (allLines.length > lines) {
    console.log(chalk.yellow(`(显示最后 ${lines} 行，共 ${allLines.length} 行)`));
    console.log("");
    console.log(allLines.slice(-lines).join("\n"));
  } else {
    console.log(content);
  }
}

async function main() {
  const program = new Command();
  program
    .name("along logs")
    .description("查看 Agent 运行日志")
    .version("1.0.0");

  program
    .command("list [issue-number]")
    .description("列出日志文件")
    .option("-n, --limit <number>", "显示数量", "10")
    .action((num, options) => {
      listLogs(num, parseInt(options.limit, 10));
    });

  program
    .command("show <file>")
    .description("显示指定日志文件内容")
    .option("-n, --lines <number>", "显示行数", "100")
    .action((file, options) => {
      showLog(file, parseInt(options.lines, 10));
    });

  program.parse();

  if (process.argv.length === 2) {
    program.outputHelp();
  }
}

main();
