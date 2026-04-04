#!/usr/bin/env bun
import { $ } from "bun";
import path from "path";
import fs from "fs";
import { consola } from "consola";
import {
  success,
  failure,
  checkGitRepo,
  iso_timestamp,
  ensureEditorPermissions,
} from "./common";
import type { Result } from "./common";

const logger = consola.withTag("run");
import { readRepoInfo } from "./github-client";
import chalk from "chalk";
import { config } from "./config";
import { runGc } from "./worktree-gc";
import { Task } from "./task";
import { Issue } from "./issue";
import { SessionManager } from "./session-manager";
import { setupWorktree, initSessionFiles } from "./worktree-init";
import { printStatusBoard } from "./status";

/**
 * run - 极简一键启动入口
 * 放在项目根目录，直接 ./run.ts <issue/pr> <number>
 */

import { Command } from "commander";

// logTag 延迟获取，避免模块加载时 worktree 未就绪导致检测失败
function getLogTag(): string {
  return config.getLogTag();
}

async function identifyTask(
  num: string,
): Promise<Result<{ taskData: any }>> {
  logger.info(`  编号: ${num}`);
  logger.info("  从 GitHub 抓取数据中...");

  const issue = new Issue(Number.parseInt(num, 10), config);
  const loadRes = await issue.load();
  if (!loadRes.success) return failure(loadRes.error);

  const healthRes = issue.checkHealth();
  if (!healthRes.success) return failure(healthRes.error);

  logger.success(`  检测到: Issue (状态: open)`);
  return success({ taskData: issue.data });
}

async function ensureWorktree(
  num: string,
  taskData: any,
): Promise<Result<string>> {
  const worktreePath = path.join(config.WORKTREE_DIR, `${num}`);
  if (fs.existsSync(worktreePath)) return success(worktreePath);

  logger.warn("工作目录不存在，将自动初始化...");

  const wtResult = await setupWorktree(worktreePath);
  if (!wtResult.success) return failure(wtResult.error);

  const repoInfoRes = await readRepoInfo();
  if (!repoInfoRes.success) return failure(repoInfoRes.error);
  const { owner, repo: repoName } = repoInfoRes.data;

  const statusFile = path.join(config.SESSION_DIR, `${num}-status.json`);
  const todoFile = path.join(config.SESSION_DIR, `${num}-todo.md`);
  const statusData = {
    issueNumber: Number(num),
    status: "running",
    startTime: iso_timestamp(),
    branchName: "",
    worktreePath,
    title: taskData.title,
    repo: { owner, name: repoName },
  };

  await initSessionFiles(worktreePath, num, statusFile, statusData, todoFile);

  logger.success("初始化完成\n");
  return success(worktreePath);
}


async function executeTask(
  num: string,
  workflow: string,
  worktreePath: string,
  options: any,
  sessionManager: SessionManager,
) {
  const tag = getLogTag();
  const editor = config.EDITORS.find((e) => e.id === tag);

  // 按照配置中的模版生成启动指令
  let cmd = editor?.runTemplate || "{tag} --prompt-template {workflow} {num}";
  cmd = cmd
    .replace("{tag}", tag)
    .replace("{workflow}", workflow)
    .replace("{num}", num);

  const startCmd = `cd ${worktreePath} && ${cmd}`;

  logger.info(`准备启动 Agent (${editor?.name || tag})...`);
  logger.info(`工作目录: ${chalk.cyan(worktreePath)}`);
  logger.info(`执行命令: ${chalk.cyan(cmd)}`);
  
  sessionManager.updateStep("启动 Agent", `执行命令: ${cmd}`);
  sessionManager.log(`Starting agent with command: ${cmd}`);

  if (options.ci) return execCi(startCmd, num, options.output, sessionManager);
  return execTmux(startCmd, num, options.tmuxSession, options.detach, sessionManager);
}

async function execCi(
  cmd: string,
  num: string,
  format: string,
  sessionManager: SessionManager,
): Promise<number> {
  logger.info("CI 模式：直接执行...");
  sessionManager.log("CI mode: executing directly");
  
  const stdout: string[] = [];
  const stderr: string[] = [];
  
  const proc = Bun.spawn(["bash", "-c", cmd], {
    stdout: "pipe",
    stderr: "pipe",
  });

  // 将 CI 进程的 PID 写入 status.json，供 GC 检测进程是否存活
  if (proc.pid) {
    const statusFile = path.join(config.SESSION_DIR, `${num}-status.json`);
    if (fs.existsSync(statusFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
        data.pid = proc.pid;
        fs.writeFileSync(statusFile, JSON.stringify(data, null, 2));
      } catch {}
    }
  }

  if (proc.stdout) {
    const reader = proc.stdout.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = new TextDecoder().decode(value);
      stdout.push(text);
      process.stdout.write(text);
    }
  }

  if (proc.stderr) {
    const reader = proc.stderr.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = new TextDecoder().decode(value);
      stderr.push(text);
      process.stderr.write(text);
    }
  }

  const exitCode = await proc.exited;
  
  if (exitCode !== 0) {
    const errorOutput = stderr.join("\n") || stdout.join("\n");
    sessionManager.markAsError(
      `Agent exited with code ${exitCode}`,
      exitCode
    );
    sessionManager.log(`Stderr: ${stderr.join("\n")}`, "error");
    sessionManager.log(`Stdout: ${stdout.join("\n")}`, "error");
  } else {
    sessionManager.markAsCompleted();
  }

  if (format === "json") {
    process.stdout.write(
      JSON.stringify({ type: "issue", number: Number(num), exitCode }) + "\n",
    );
  }
  return exitCode;
}

async function execTmux(
  cmd: string,
  num: string,
  sessionName?: string,
  detach?: boolean,
  sessionManager?: SessionManager,
) {
  const session = sessionName || `pi-${num}`;
  logger.info(`在 tmux 中创建新窗口并自动切换到会话: ${session}...`);
  if (sessionManager) {
    sessionManager.log(`Starting tmux session: ${session}`);
  }

  // 防止 Agent 启动崩溃导致 tmux 窗口瞬间消失闪退
  const logFile = path.join(config.LOG_DIR, `${num}-tmux.log`);
  const statusFile = path.join(config.SESSION_DIR, `${num}-status.json`);

  // Agent 完成后更新 status.json，确保外部监控能检测到完成/崩溃
  const updateStatusScript = `
    bun -e "
      const fs = require('fs');
      const f = '${statusFile}';
      if (fs.existsSync(f)) {
        const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
        if (s.status === 'running') {
          const exitCode = Number(process.argv[1]) || 0;
          s.status = exitCode === 0 ? 'completed' : 'crashed';
          s.endTime = new Date().toISOString();
          s.lastUpdate = new Date().toISOString();
          if (exitCode !== 0) s.errorMessage = 'Agent 退出码: ' + exitCode;
          fs.writeFileSync(f, JSON.stringify(s, null, 2));
        }
      }
    "
  `.trim();

  // 启动时将 shell PID 写入 status.json，供 GC 检测进程是否存活
  const writePidScript = `
    bun -e "
      const fs = require('fs');
      const f = '${statusFile}';
      if (fs.existsSync(f)) {
        const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
        s.pid = Number(process.argv[1]);
        fs.writeFileSync(f, JSON.stringify(s, null, 2));
      }
    " \$\$
  `.trim();

  const safeCmd = `bash -c '
    echo "Starting at $(date)" > ${logFile}
    ${writePidScript} 2>/dev/null || true
    ${cmd.replace(/'/g, "'\\''")} 2>&1 | tee -a ${logFile}
    EXIT_CODE=\${PIPESTATUS[0]}
    ${updateStatusScript} \${EXIT_CODE} 2>/dev/null || true
    if [ \${EXIT_CODE} -ne 0 ]; then
      echo ""
      echo "⚠️ Agent 意外崩溃 (退出码: \${EXIT_CODE})"
      echo "日志已保存到: ${logFile}"
      echo "按 Enter 键关闭当前窗口..."
      read
      exit \${EXIT_CODE}
    fi
  '`;

  try {
    await $`tmux new-window -n ${session} ${safeCmd}`;

    if (!detach) {
      await $`tmux select-window -t ${session}`;
    } else {
      logger.success(`Tmux 窗口已创建并在后台运行: ${session}`);
      if (sessionManager) {
        sessionManager.log(`Tmux window created and running in background: ${session}`);
      }
    }
  } catch (error: any) {
    const errorMsg = `Failed to create tmux window: ${error.message}`;
    logger.error(errorMsg);
    if (sessionManager) {
      sessionManager.markAsCrashed(errorMsg, error.stack);
    }
    throw error;
  }
}

async function execForeground(cmd: string): Promise<number> {
  logger.info("前台运行模式...");
  const proc = Bun.spawn(["bash", "-c", cmd], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  return await proc.exited;
}

async function tryGetSessionTask(num: string) {
  const sessionsDir = config.SESSION_DIR;
  const issueSessionPath = path.join(sessionsDir, `${num}-status.json`);
  const worktreePath = path.join(config.WORKTREE_DIR, `${num}`);

  if (fs.existsSync(issueSessionPath) && fs.existsSync(worktreePath)) {
    logger.info(`  检测到现有状况: Issue #${num} (从 Session 快进)`);
    const session = JSON.parse(fs.readFileSync(issueSessionPath, "utf-8"));
    return {
      taskData: { title: session.title, number: Number(num) },
    };
  }
  return null;
}

async function runTask(num: string, options: any, sessionManager: SessionManager): Promise<Result<null>> {
  let task = await tryGetSessionTask(num);
  if (!task) {
    const idResult = await identifyTask(num);
    if (!idResult.success) return failure(idResult.error);
    task = idResult.data;
  }

  const wtResult = await ensureWorktree(
    num,
    task.taskData,
  );
  if (!wtResult.success) return failure(wtResult.error);

  ensureEditorPermissions(wtResult.data);

  const workflow = "resolve-github-issue";
  await executeTask(num, workflow, wtResult.data, options, sessionManager);
  return success(null);
}

const welcome = () => {
  logger.log(chalk.cyan("======================================"));
  logger.log(chalk.bold.cyan(`  ALONG 一键启动 (Bun 版)`));
  logger.log(chalk.cyan("======================================"));
  logger.log("");
};

const tmuxCheck = () => {
  if (process.env.TMUX) {
    return success(null);
  }

  const error = `错误：强制要求在 tmux 环境中运行。
💡 建议做法：
  1. 执行 tmux 进入环境后，再次运行本命令（推荐，可多窗口切换）；
  2. 如果在脚本/CI 环境中运行，请添加 --ci 参数跳过此检查。
`;
  return failure(error);
};

async function checkEnv() {
  const projectRoot = process.cwd();
  if (!fs.existsSync(config.ROOT_DIR)) {
    return failure(
      `错误: ${config.ROOT_DIR} 目录不存在于 ${projectRoot}，请确认在项目根目录执行`,
    );
  }

  const gitResult = await checkGitRepo();
  if (!gitResult.success) return gitResult;
  logger.success("本地git仓库检测通过");

  const repoResult = await readRepoInfo();
  if (!repoResult.success) return repoResult;
  logger.success("远程git仓库检测通过");

  const tmuxResult = tmuxCheck();
  if (!tmuxResult.success) return tmuxResult;
  logger.success("tmux环境检测通过");

  return success(null);
}

async function showStatusBoard() {
  await printStatusBoard();
}

function configureCommand() {
  const program = new Command();
  program
    .name("./run.ts")
    .description(`ALONG 一键启动 (Bun 版)`)
    .version("1.0.0")
    .configureOutput({
      writeErr: (str) => {
        if (str.includes("error: missing required argument")) {
          const arg = str.match(/'(.+)'/)?.[1];
          process.stderr.write(
            `along run缺少必要的参数[${arg}]，例如：along run 42\n`,
          );
        } else if (str.includes("error: unknown option")) {
          const opt = str.match(/'(.+)'/)?.[1] || "选项";
          process.stderr.write(`错误：未知选项 '${opt}'\n`);
        } else {
          process.stderr.write(str);
        }
      },
    })
    .argument("<编号>", "Issue 编号")
    .option(
      "--ci",
      "CI 模式：跳过 tmux 环境检查，直接在前台执行（适用于脚本调用）",
      false,
    )
    .option("--output <format>", "输出格式 (text 或 json)", "text")
    .option("-d, --detach", "创建 tmux 窗口后，不自动进入该窗口");

  return program;
}

const checkTask = (taskNo: number) => {
  const task = new Task(taskNo, config);
  const healthRes = task.checkHealth();

  if (!healthRes?.success) return healthRes;

  return success(null);
};

const checkIssue = async (taskNo: number) =>{
  const issue = new Issue(taskNo, config);
  const loadRes = await issue.load();

  if (!loadRes.success) return loadRes;

  const healthRes = issue.checkHealth();
  if (!healthRes.success) return healthRes;

  return success(issue.data)
}



async function handleAction(num: string, options: any) {
  const taskNo = Number.parseInt(num, 10);
  const sessionManager = new SessionManager(taskNo, config);

  try {
    const issueRes = await checkIssue(taskNo);
    if (!issueRes.success) {
      sessionManager.markAsError(issueRes.error);
      throw new Error(issueRes.error);
    }
    logger.success("issue检测通过");

    // 将 Issue 数据持久化，供 Agent prompt 直接读取
    const issueJsonPath = path.join(config.SESSION_DIR, `${num}-issue.json`);
    fs.writeFileSync(issueJsonPath, JSON.stringify(issueRes.data, null, 2));

    const taskRes = checkTask(taskNo)
    if (!taskRes.success) {
      sessionManager.markAsError(taskRes.error);
      throw new Error(taskRes.error);
    }
    logger.success("task检测通过");

    sessionManager.updateStep("准备环境检查", "正在检查Git仓库和Issue状态");

    try {
      await runGc({ silent: true });
    } catch {
      /* gc 失败不影响主流程 */
      sessionManager.log("GC failed, but continuing anyway", "warn");
    }

    sessionManager.updateStep("启动任务处理", "开始执行任务流程");

    const res = await runTask(num, options, sessionManager);
    if (!res.success) {
      sessionManager.markAsError(res.error);
      throw new Error(res.error);
    }

    await showStatusBoard();
  } catch (error: any) {
    const errorMsg = error.message || String(error);
    sessionManager.markAsCrashed(errorMsg, error.stack);
    logger.error(`任务执行异常: ${errorMsg}`);
    console.error(error.stack);
    process.exit(1);
  }
}

async function main() {
  config.ensureDataDirs();
  welcome();

  const envRes = await checkEnv();
  if (!envRes.success) {
    logger.error(envRes.error);
    process.exit(1);
  }

  const program = configureCommand();
  program.action(handleAction);
  program.parse();
}

main();
