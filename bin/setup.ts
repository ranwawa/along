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
    "run": "一键启动（默认前台，支持 --ci）",
    "webhook-server": "启动本地 webhook 服务器，接收 GitHub App webhook 事件（支持 --watch 热重载）",
  };

  for (const name of commands) {
    const desc = descriptions[name];
    if (desc) {
      console.log(`  ${name.padEnd(25)} - ${desc}`);
    }
  }

  console.log("");
  console.log(chalk.cyan("快速开始:"));
  console.log(`  along webhook-server  # 启动 webhook 服务`);
  console.log(`  along run 42          # 手动处理 Issue 42`);
  console.log("");
}

/**
 * 分发子命令
 */
async function dispatch(subCommand: string, args: string[], binDir: string, commands: string[], tag: string) {
  const scriptPath = path.join(binDir, `${subCommand}.ts`);
  const isInternal = ['setup', 'config', 'common', 'exec', 'github-client', 'worktree-init', 'session-manager', 'task', 'issue', 'webhook-handlers', 'issue-triage', 'app-init', 'bootstrap'].includes(subCommand);
  const watch = args.includes("--watch");
  const forwardedArgs = args.filter((arg) => arg !== "--watch");

  if (commands.includes(subCommand) && !isInternal) {
    const proc = Bun.spawn([Bun.argv[0], ...(watch ? ["--watch"] : []), scriptPath, ...forwardedArgs], {
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
  const tagResult = config.getLogTag();
  const args = process.argv.slice(2);

  if (!fs.existsSync(binDir)) {
    console.error(`错误: bin 目录不存在: ${binDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(binDir).filter(f => f.endsWith(".ts"));
  const commands = files.map(f => f.replace(".ts", ""));

  // 这里的 tag 仅用于展示帮助或回显，如果获取失败则默认使用 "ALONG"
  const tag = tagResult.success ? tagResult.data : "ALONG";

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
