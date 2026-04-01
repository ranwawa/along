#!/usr/bin/env bun
/**
 * setup.ts - ALONG 自动化工具入口与命令分发
 */
import { config } from "./config";
import fs from "fs";
import path from "path";
import chalk from "chalk";

/**
 * 展示帮助列表
 */
function printHelp(commands: string[], tag: string) {
  console.log("");
  console.log(chalk.bold.cyan(`${tag.toUpperCase()} 可用命令 (由 Bun 驱动):`));
  
  const descriptions: Record<string, string> = {
    "cleanup": "清理 Issue 工作空间",
    "issue-list": "列出所有任务状态",
    "issue-status": "更新任务状态",
    "issue-details": "获取 Issue 详情并执行安全校验",
    "issue-comment": "在 Issue 中发表评论",
    "issue-label": "给 Issue 添加标签",
    "commit-push": "将变更进行原子化 Commit 并推送到远端",
    "run": "一键启动（默认前台，支持 --tmux）",
    "worktree-gc": "批量清理已合并/已关闭的 worktree",
    "sync-editor": "同步公共资源到编辑器目录"
  };

  for (const name of commands) {
    const desc = descriptions[name];
    if (desc) {
      console.log(`  ${name.padEnd(25)} - ${desc}`);
    }
  }

  console.log("");
  console.log(chalk.cyan("快速开始:"));
  console.log(`  along sync-editor  # 同步编辑器配置`);
  console.log(`  along run 42       # 处理 Issue 42`);
  console.log("");
}

/**
 * 分发子命令
 */
async function dispatch(subCommand: string, args: string[], binDir: string, commands: string[], tag: string) {
  const scriptPath = path.join(binDir, `${subCommand}.ts`);
  const isInternal = ['setup', 'config', 'common', 'exec', 'github-client', 'worktree-init', 'session-manager', 'task', 'issue'].includes(subCommand);

  if (commands.includes(subCommand) && !isInternal) {
    const proc = Bun.spawn([Bun.argv[0], scriptPath, ...args], {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });
    process.exit(await proc.exited);
  } else if (subCommand === '--help' || subCommand === '-h') {
    printHelp(commands, tag);
  } else {
    console.error(chalk.red(`错误: 未知命令 "${subCommand}"`));
    process.exit(1);
  }
}

async function main() {
  config.ensureDataDirs();
  const binDir = config.BIN_DIR;
  const tag = config.getLogTag();
  const args = process.argv.slice(2);

  if (!fs.existsSync(binDir)) {
    console.error(`错误: bin 目录不存在: ${binDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(binDir).filter(f => f.endsWith(".ts"));
  const commands = files.map(f => f.replace(".ts", ""));

  if (args.length > 0) {
    await dispatch(args[0], args.slice(1), binDir, commands, tag);
  } else {
    printHelp(commands, tag);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
