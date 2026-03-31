#!/usr/bin/env bun
import { $ } from "bun";
import path from "path";
import fs from "fs";
import {
  log_info,
  log_error,
  log_warn,
  log_success,
  logger,
  success,
  failure,
  checkGitRepo,
} from "./common";
import type { Result } from "./common";
import { get_gh_client, readRepoInfo } from "./github-client";
import chalk from "chalk";
import { config } from "./config";
import { runGc } from "./worktree-gc";
import { Task } from "./task";
import { Issue } from "./issue";

/**
 * run - 极简一键启动入口
 * 放在项目根目录，直接 ./run.ts <issue/pr> <number>
 */

import { Command } from "commander";

const logTag = config.getLogTag();

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
  binDir: string,
): Promise<Result<string>> {
  const worktreePath = path.join(config.WORKTREE_DIR, `${num}`);
  if (fs.existsSync(worktreePath)) return success(worktreePath);

  log_warn("工作目录不存在，将自动初始化...");
  const startScript = path.join(binDir, `issue-start.ts`);
  const dataStr = JSON.stringify(taskData);

  const initProc = Bun.spawn(
    ["bun", startScript, num, "--data", dataStr, "--skip-checks"],
    {
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  if ((await initProc.exited) !== 0) {
    return failure(`issue-start 失败，请检查错误信息`);
  }

  log_success("初始化完成\n");
  return success(worktreePath);
}

async function executeTask(
  num: string,
  workflow: string,
  worktreePath: string,
  options: any,
) {
  const editor = config.EDITORS.find((e) => e.id === logTag);

  // 按照配置中的模版生成启动指令
  let cmd = editor?.runTemplate || "{tag} --prompt-template {workflow} {num}";
  cmd = cmd
    .replace("{tag}", logTag)
    .replace("{workflow}", workflow)
    .replace("{num}", num);

  const startCmd = `cd ${worktreePath} && ${cmd}`;

  log_info(`准备启动 Agent (${editor?.name || logTag})...`);
  log_info(`工作目录: ${chalk.cyan(worktreePath)}`);
  log_info(`执行命令: ${chalk.cyan(cmd)}`);

  if (options.ci) return execCi(startCmd, num, options.output);
  return execTmux(startCmd, num, options.tmuxSession, options.detach);
}

async function execCi(
  cmd: string,
  num: string,
  format: string,
): Promise<number> {
  log_info("CI 模式：直接执行...");
  const proc = Bun.spawn(["bash", "-c", cmd], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
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
) {
  const session = sessionName || `pi-${num}`;
  log_info(`在 tmux 中创建新窗口并自动切换到会话: ${session}...`);

  // 防止 Agent 启动崩溃导致 tmux 窗口瞬间消失闪退
  const safeCmd = `bash -c '${cmd.replace(/'/g, "'\\''")} || { echo ""; echo "⚠️ Agent 意外崩溃 (退出码: $?)"; echo "按 Enter 键关闭当前窗口..."; read; exit 1; }'`;

  await $`tmux new-window -n ${session} ${safeCmd}`;

  if (!detach) {
    await $`tmux select-window -t ${session}`;
  } else {
    log_success(`Tmux 窗口已创建并在后台运行: ${session}`);
  }
}

async function execForeground(cmd: string): Promise<number> {
  log_info("前台运行模式...");
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

  if (fs.existsSync(issueSessionPath)) {
    logger.info(`  检测到现有状况: Issue #${num} (从 Session 快进)`);
    const session = JSON.parse(fs.readFileSync(issueSessionPath, "utf-8"));
    return {
      taskData: { title: session.title, number: Number(num) },
    };
  }
  return null;
}

async function runTask(num: string, options: any): Promise<Result<null>> {
  let task = await tryGetSessionTask(num);
  if (!task) {
    const idResult = await identifyTask(num);
    if (!idResult.success) return failure(idResult.error);
    task = idResult.data;
  }

  const wtResult = await ensureWorktree(
    num,
    task.taskData,
    config.BIN_DIR,
  );
  if (!wtResult.success) return failure(wtResult.error);

  const workflow = "resolve-github-issue";
  await executeTask(num, workflow, wtResult.data, options);
  return success(null);
}

const welcome = () => {
  logger.log(chalk.cyan("======================================"));
  logger.log(chalk.bold.cyan(`  ${logTag.toUpperCase()} 一键启动 (Bun 版)`));
  logger.log(chalk.cyan("======================================"));
  logger.log("");
};

const tmuxCheck = () => {
  if (process.env.TMUX) {
    return success(null, "tmux环境检测通过");
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

  const repoResult = await readRepoInfo();
  if (!repoResult.success) return repoResult;

  const tmuxResult = tmuxCheck();
  if (!tmuxResult.success) return tmuxResult;

  return success(null);
}

async function showStatusBoard() {
  const binDir = config.BIN_DIR;
  const proc = Bun.spawn(["bun", path.join(binDir, "status.ts")], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  await proc.exited;
}

function configureCommand() {
  const program = new Command();
  program
    .name("./run.ts")
    .description(`${logTag.toUpperCase()} 一键启动 (Bun 版)`)
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

  return success(null, 'task检测通过');
};

const checkIssue = async (taskNo: number) =>{
  const issue = new Issue(taskNo, config);
  const loadRes = await issue.load();

  if (!loadRes.success) return loadRes;

  const healthRes = issue.checkHealth();
  if (!healthRes.success) return healthRes;

  return success(null, 'issue检测通过')
}



async function handleAction(num: string, options: any) {
  const taskNo = Number.parseInt(num, 10);

  const issueRes = await checkIssue(taskNo);
  if (!issueRes.success) return failure(issueRes.error);

  const taskRes = checkTask(taskNo)
  if (!taskRes.success) throw new Error(taskRes.error);

  try {
    await runGc({ silent: true });
  } catch {
    /* gc 失败不影响主流程 */
  }

  const res = await runTask(num, options);
  if (!res.success) {
    log_error(res.error);
    process.exit(1);
  }

  await showStatusBoard();
}

async function main() {
  welcome();

  const envRes = await checkEnv();
  if (!envRes.success) throw new Error(envRes.error);

  const program = configureCommand();
  program.action(handleAction);
  program.parse();
}

main();
