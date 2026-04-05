#!/usr/bin/env bun
/**
 * logs.ts - 查看 Agent 运行日志的辅助工具
 */

import path from "path";
import fs from "fs";
import { consola } from "consola";

const logger = consola.withTag("logs");
import { Command } from "commander";
import chalk from "chalk";
import { findAllSessions, SessionPathManager } from "./session-paths";

function getDirSize(dirPath: string): number {
  let total = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += getDirSize(full);
    } else {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

async function listLogs(num?: string, limit: number = 10) {
  const allSessions = findAllSessions();
  if (allSessions.length === 0) {
    logger.info("暂无日志");
    return;
  }

  let files: { name: string; path: string; mtime: Date; size: number; category: string }[] = [];

  for (const session of allSessions) {
    const paths = new SessionPathManager(session.owner, session.repo, session.issueNumber);
    const prefix = `${session.owner}/${session.repo}#${session.issueNumber}`;
    const issueDir = paths.getIssueDir();

    // 所有需要扫描的文件及其分类
    const scanTargets: { filePath: string; category: string }[] = [
      { filePath: paths.getLogFile(), category: "日志" },
      { filePath: paths.getTmuxLogFile(), category: "日志" },
      { filePath: paths.getPrReviewTmuxLogFile(), category: "日志" },
      { filePath: paths.getEventLogFile(), category: "事件" },
      { filePath: paths.getStatusFile(), category: "状态" },
      { filePath: paths.getTodoFile(), category: "进度" },
      { filePath: paths.getIssueFile(), category: "数据" },
      { filePath: paths.getPrCommentsFile(), category: "PR" },
      { filePath: paths.getCiFailuresFile(), category: "CI" },
      { filePath: paths.getAgentSessionExport(), category: "Agent" },
    ];

    for (const { filePath, category } of scanTargets) {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        files.push({
          name: `${prefix} - ${path.basename(filePath)}`,
          path: filePath,
          mtime: stat.mtime,
          size: stat.size,
          category,
        });
      }
    }

    // 扫描 step*.md 文件
    if (fs.existsSync(issueDir)) {
      const stepFiles = fs.readdirSync(issueDir).filter(f => /^step\d+-.+\.md$/.test(f));
      for (const stepFile of stepFiles) {
        const filePath = path.join(issueDir, stepFile);
        const stat = fs.statSync(filePath);
        files.push({
          name: `${prefix} - ${stepFile}`,
          path: filePath,
          mtime: stat.mtime,
          size: stat.size,
          category: "步骤",
        });
      }
    }

    // 扫描 tmux-clean.log
    const tmuxCleanLog = path.join(issueDir, "tmux-clean.log");
    if (fs.existsSync(tmuxCleanLog)) {
      const stat = fs.statSync(tmuxCleanLog);
      files.push({
        name: `${prefix} - tmux-clean.log`,
        path: tmuxCleanLog,
        mtime: stat.mtime,
        size: stat.size,
        category: "日志",
      });
    }

    // 扫描 agent-data/ 目录
    const agentDataDir = path.join(issueDir, "agent-data");
    if (fs.existsSync(agentDataDir)) {
      const totalSize = getDirSize(agentDataDir);
      const stat = fs.statSync(agentDataDir);
      files.push({
        name: `${prefix} - agent-data/`,
        path: agentDataDir,
        mtime: stat.mtime,
        size: totalSize,
        category: "Agent",
      });
    }
  }

  files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  if (num) {
    files = files.filter((f) => f.path.includes(`/${num}/`));
  }

  if (files.length === 0) {
    logger.info(num ? `Issue #${num} 暂无日志` : "暂无日志");
    return;
  }

  logger.success(`找到 ${files.length} 个日志/数据文件`);
  console.log("");

  files.slice(0, limit).forEach((file, idx) => {
    const timeStr = file.mtime.toLocaleString("zh-CN");
    const sizeKb = (file.size / 1024).toFixed(1);
    const categoryTag = chalk.gray(`[${file.category}]`);
    console.log(
      `${chalk.cyan(idx + 1 + ".")} ${categoryTag} ${chalk.bold(file.name)}`,
    );
    console.log(`   时间: ${timeStr} | 大小: ${sizeKb} KB`);
    console.log(`   路径: ${chalk.dim(file.path)}`);
    console.log("");
  });

  if (files.length > limit) {
    logger.info(`... 还有 ${files.length - limit} 个文件未显示，使用 -n 参数增加显示数量`);
  }
}

async function showLog(filePath: string, lines: number = 100) {
  if (!fs.existsSync(filePath)) {
    logger.error(`日志文件不存在: ${filePath}`);
    return;
  }

  const ext = path.extname(filePath);
  const content = fs.readFileSync(filePath, "utf-8");

  console.log(chalk.cyan("=".repeat(60)));
  console.log(chalk.bold(`文件: ${path.basename(filePath)}`));
  console.log(chalk.cyan("=".repeat(60)));
  console.log("");

  // JSON 文件格式化输出
  if (ext === ".json") {
    try {
      const data = JSON.parse(content);
      console.log(JSON.stringify(data, null, 2));
    } catch {
      console.log(content);
    }
    return;
  }

  // JSONL 文件逐行解析
  if (ext === ".jsonl") {
    const jsonLines = content.split("\n").filter(l => l.trim());
    const displayLines = jsonLines.length > lines ? jsonLines.slice(-lines) : jsonLines;
    if (jsonLines.length > lines) {
      console.log(chalk.yellow(`(显示最后 ${lines} 条记录，共 ${jsonLines.length} 条)`));
      console.log("");
    }
    for (const line of displayLines) {
      try {
        const obj = JSON.parse(line);
        const ts = obj.timestamp || obj.ts || "";
        const event = obj.event || obj.type || "";
        const msg = obj.message || obj.msg || "";
        if (ts || event) {
          console.log(`${chalk.gray(ts)} ${chalk.cyan(event)} ${msg}`);
          const rest = { ...obj };
          delete rest.timestamp; delete rest.ts; delete rest.event; delete rest.type; delete rest.message; delete rest.msg;
          if (Object.keys(rest).length > 0) {
            console.log(chalk.dim(`  ${JSON.stringify(rest)}`));
          }
        } else {
          console.log(JSON.stringify(obj, null, 2));
        }
      } catch {
        console.log(line);
      }
    }
    return;
  }

  // 普通文本文件
  const allLines = content.split("\n");
  if (allLines.length > lines) {
    console.log(chalk.yellow(`(显示最后 ${lines} 行，共 ${allLines.length} 行)`));
    console.log("");
    console.log(allLines.slice(-lines).join("\n"));
  } else {
    console.log(content);
  }
}

async function showSummary(num: string) {
  const allSessions = findAllSessions();
  const session = allSessions.find(s => s.issueNumber === Number(num));
  if (!session) {
    logger.error(`未找到 Issue #${num} 的会话数据`);
    return;
  }

  const paths = new SessionPathManager(session.owner, session.repo, session.issueNumber);
  const prefix = `${session.owner}/${session.repo}#${session.issueNumber}`;

  console.log(chalk.cyan("=".repeat(60)));
  console.log(chalk.bold(`  会话概览: ${prefix}`));
  console.log(chalk.cyan("=".repeat(60)));
  console.log("");

  // status.json 概览
  const statusFile = paths.getStatusFile();
  if (fs.existsSync(statusFile)) {
    try {
      const status = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
      const statusColor = status.status === "completed" ? chalk.green :
        status.status === "running" ? chalk.yellow :
        status.status === "crashed" ? chalk.red : chalk.gray;
      console.log(`  状态: ${statusColor(status.status)}`);
      console.log(`  标题: ${status.title || "N/A"}`);
      if (status.branchName) console.log(`  分支: ${chalk.cyan(status.branchName)}`);
      if (status.prUrl) console.log(`  PR: ${chalk.cyan(status.prUrl)}`);
      if (status.agentType) console.log(`  Agent: ${status.agentType}`);
      if (status.startTime) console.log(`  开始: ${status.startTime}`);
      if (status.endTime) console.log(`  结束: ${status.endTime}`);
      if (status.commitShas?.length) console.log(`  Commits: ${status.commitShas.length} 个`);
      if (status.retryCount) console.log(`  重试: ${status.retryCount} 次`);
      if (status.ciResults) {
        const ci = status.ciResults;
        console.log(`  CI: ${chalk.green(`${ci.passed} 通过`)} / ${chalk.red(`${ci.failed} 失败`)}`);
      }
      if (status.reviewCommentCount) console.log(`  Review 评论: ${status.reviewCommentCount} 条`);
      if (status.errorMessage) console.log(`  错误: ${chalk.red(status.errorMessage)}`);
      if (status.environment) {
        const env = status.environment;
        console.log(`  环境: ${env.agentType} | Along ${env.alongVersion} | ${env.platform}`);
        console.log(`  Git HEAD: ${env.gitHeadSha?.substring(0, 8) || "N/A"}`);
      }
    } catch {}
  }

  console.log("");

  // 文件清单
  console.log(chalk.bold("  文件清单:"));
  const issueDir = paths.getIssueDir();
  if (fs.existsSync(issueDir)) {
    const allFiles = fs.readdirSync(issueDir).filter(f => {
      const full = path.join(issueDir, f);
      return fs.statSync(full).isFile();
    });
    for (const file of allFiles.sort()) {
      const filePath = path.join(issueDir, file);
      const stat = fs.statSync(filePath);
      const sizeKb = (stat.size / 1024).toFixed(1);
      console.log(`    ${chalk.dim(sizeKb.padStart(8) + " KB")}  ${file}`);
    }
    // agent-data 目录
    const agentDataDir = path.join(issueDir, "agent-data");
    if (fs.existsSync(agentDataDir)) {
      const totalSize = getDirSize(agentDataDir);
      console.log(`    ${chalk.dim((totalSize / 1024).toFixed(1).padStart(8) + " KB")}  agent-data/`);
    }
  }

  console.log("");

  // 步骤历史
  if (fs.existsSync(statusFile)) {
    try {
      const status = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
      if (status.stepHistory?.length) {
        console.log(chalk.bold("  步骤历史:"));
        for (const step of status.stepHistory) {
          const duration = step.startTime && step.endTime
            ? ` (${((new Date(step.endTime).getTime() - new Date(step.startTime).getTime()) / 1000).toFixed(0)}s)`
            : "";
          const icon = step.endTime ? chalk.green("✓") : chalk.yellow("…");
          console.log(`    ${icon} ${step.name}${chalk.dim(duration)}`);
        }
        console.log("");
      }
    } catch {}
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

  program
    .command("summary <issue-number>")
    .description("显示指定 Issue 的会话概览")
    .action((num) => {
      showSummary(num);
    });

  program.parse();

  if (process.argv.length === 2) {
    program.outputHelp();
  }
}

main();
