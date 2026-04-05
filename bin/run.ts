#!/usr/bin/env bun
import { $ } from "bun";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { consola } from "consola";
import {
  success,
  failure,
  checkGitRepo,
  iso_timestamp,
  ensureEditorPermissions,
  check_process_running,
} from "./common";
import type { Result } from "./common";

const logger = consola.withTag("run");
import { readRepoInfo, readGithubToken, get_gh_client } from "./github-client";
import chalk from "chalk";
import { config } from "./config";
import { runGc } from "./worktree-gc";
import { Task } from "./task";
import { Issue } from "./issue";
import { SessionManager } from "./session-manager";
import { SessionPathManager } from "./session-paths";
import { setupWorktree, initSessionFiles } from "./worktree-init";
import { printStatusBoard } from "./status";
import { getAgentRole } from "./agent-config";

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
  paths: SessionPathManager,
  owner: string,
  repoName: string,
): Promise<Result<string>> {
  const worktreePath = paths.getWorktreeDir();
  if (fs.existsSync(worktreePath)) return success(worktreePath);

  logger.warn("工作目录不存在，将自动初始化...");

  const wtResult = await setupWorktree(worktreePath);
  if (!wtResult.success) return failure(wtResult.error);

  const statusData: Record<string, any> = {
    issueNumber: Number(num),
    status: "running",
    startTime: iso_timestamp(),
    branchName: "",
    worktreePath,
    title: taskData.title,
    repo: { owner, name: repoName },
  };

  const agentRole = getAgentRole();
  if (agentRole) {
    statusData.agentRole = agentRole;
  }

  await initSessionFiles(paths, worktreePath, statusData);

  logger.success("初始化完成\n");
  return success(worktreePath);
}


async function executeTask(
  num: string,
  workflow: string,
  worktreePath: string,
  options: any,
  sessionManager: SessionManager,
  paths: SessionPathManager,
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

  if (options.ci) return execCi(startCmd, num, options.output, sessionManager, paths);
  return execTmux(startCmd, num, options.tmuxSession, options.detach, sessionManager, paths);
}

async function execCi(
  cmd: string,
  num: string,
  format: string,
  sessionManager: SessionManager,
  paths: SessionPathManager,
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
    const statusFile = paths.getStatusFile();
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
  paths?: SessionPathManager,
) {
  const tag = getLogTag();
  const session = sessionName || `${tag}-${num}`;
  logger.info(`在 tmux 中创建新窗口并自动切换到会话: ${session}...`);
  if (sessionManager) {
    sessionManager.log(`Starting tmux session: ${session}`);
  }

  // 构建需要注入到 tmux 环境中的变量（确保 agent 进程内的 gh 命令使用正确的 token）
  const envExports: string[] = [];
  const agentRole = getAgentRole();
  if (agentRole) {
    envExports.push(`export ALONG_AGENT_ROLE='${agentRole}'`);
  }
  const tokenRes = await readGithubToken();
  if (tokenRes.success) {
    envExports.push(`export GH_TOKEN='${tokenRes.data}'`);
  }
  const envSetup = envExports.length > 0 ? envExports.join("; ") + "; " : "";

  // 防止 Agent 启动崩溃导致 tmux 窗口瞬间消失闪退
  const logFile = paths ? paths.getTmuxLogFile() : "";
  const statusFile = paths ? paths.getStatusFile() : "";

  // Agent 完成后更新 status.json，确保外部监控能检测到完成/崩溃
  // 当 exitCode 非零时，额外读取日志文件最后 20 行作为 crashLog
  const updateStatusScript = `
    bun -e "
      const fs = require('fs');
      const f = '${statusFile}';
      const logPath = '${logFile}';
      if (fs.existsSync(f)) {
        const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
        if (s.status === 'running') {
          const exitCode = Number(process.argv[1]) || 0;
          s.status = exitCode === 0 ? 'completed' : 'crashed';
          s.endTime = new Date().toISOString();
          s.lastUpdate = new Date().toISOString();
          if (exitCode !== 0) {
            s.errorMessage = 'Agent 退出码: ' + exitCode;
            s.exitCode = exitCode;
            try {
              if (fs.existsSync(logPath)) {
                const lines = fs.readFileSync(logPath, 'utf-8').split('\\n');
                s.crashLog = lines.slice(-20).join('\\n');
              }
            } catch {}
          }
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
    ${envSetup}echo "Starting at $(date)" > ${logFile}
    ${writePidScript} 2>/dev/null || true
    ${cmd.replace(/'/g, "'\\''")} 2>&1 | tee -a ${logFile}
    EXIT_CODE=\${PIPESTATUS[0]}
    ${updateStatusScript} \${EXIT_CODE} 2>/dev/null || true
    if [ \${EXIT_CODE} -ne 0 ]; then
      echo ""
      echo "⚠️ Agent 意外崩溃 (退出码: \${EXIT_CODE})"
      echo "日志已保存到: ${logFile}"
      # 发送系统通知和终端 bell，让用户即使不在 tmux 窗口也能感知
      osascript -e "display notification \\"Agent 异常退出 (退出码: \${EXIT_CODE})\\" with title \\"Along 任务中断\\" subtitle \\"Issue #${num}\\"" 2>/dev/null || true
      printf "\\a" 2>/dev/null || true
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

async function tryGetSessionTask(paths: SessionPathManager) {
  const statusFile = paths.getStatusFile();
  const worktreePath = paths.getWorktreeDir();

  if (fs.existsSync(statusFile) && fs.existsSync(worktreePath)) {
    const session = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
    logger.info(`  检测到现有状况: Issue #${paths.getIssueNumber()} (从 Session 快进)`);
    return {
      taskData: { title: session.title, number: paths.getIssueNumber() },
    };
  }
  return null;
}

async function runTask(num: string, options: any, sessionManager: SessionManager, paths: SessionPathManager, owner: string, repoName: string): Promise<Result<null>> {
  let task = await tryGetSessionTask(paths);
  if (!task) {
    const idResult = await identifyTask(num);
    if (!idResult.success) return failure(idResult.error);
    task = idResult.data;
  }

  const wtResult = await ensureWorktree(
    num,
    task.taskData,
    paths,
    owner,
    repoName,
  );
  if (!wtResult.success) return failure(wtResult.error);

  ensureEditorPermissions(wtResult.data);

  const workflow = "resolve-github-issue";
  await executeTask(num, workflow, wtResult.data, options, sessionManager, paths);
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

/**
 * WIP 标签智能恢复：当 Issue 带有 WIP 标签但对应的 tmux 窗口已不存在且进程已退出时，
 * 自动清理 WIP 标签，允许用户重新启动任务
 */
async function tryRecoverFromWip(taskNo: number, paths: SessionPathManager): Promise<boolean> {
  // 检查 tmux 窗口是否存在（匹配任意 agent 类型的窗口名）
  const tmuxWindowSuffix = `-${taskNo}`;
  let windowAlive = false;
  try {
    const output = execSync("tmux list-windows -a -F '#{window_name}'", {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    windowAlive = output.split("\n").some((w) => w.trim().endsWith(tmuxWindowSuffix));
  } catch {
    // tmux 不可用，视为窗口不存在
  }

  if (windowAlive) {
    logger.warn(`Issue #${taskNo} 的 tmux 窗口仍在运行，无法自动恢复`);
    return false;
  }

  // 检查 status.json 中的 PID 是否存活
  const statusFile = paths.getStatusFile();
  if (fs.existsSync(statusFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
      if (data.pid && await check_process_running(data.pid)) {
        logger.warn(`Issue #${taskNo} 的进程 (PID: ${data.pid}) 仍在运行，无法自动恢复`);
        return false;
      }
    } catch {}
  }

  // tmux 窗口不存在且进程已退出，自动清理 WIP 标签
  logger.warn(`Issue #${taskNo} 的 WIP 标签残留（tmux 窗口已关闭、进程已退出），正在自动清理...`);
  try {
    const clientRes = await get_gh_client();
    if (clientRes.success) {
      await clientRes.data.removeIssueLabel(taskNo, "WIP");
      logger.success(`Issue #${taskNo} 的 WIP 标签已自动清理，任务将重新启动`);
      return true;
    }
  } catch (e: any) {
    logger.warn(`自动清理 WIP 标签失败: ${e.message}`);
  }
  return false;
}

async function handleAction(num: string, options: any) {
  // 提前获取 owner/repo
  const repoInfoRes = await readRepoInfo();
  if (!repoInfoRes.success) {
    logger.error(repoInfoRes.error);
    process.exit(1);
  }
  const { owner, repo: repoName } = repoInfoRes.data;

  const taskNo = Number.parseInt(num, 10);
  const paths = new SessionPathManager(owner, repoName, taskNo);
  const sessionManager = new SessionManager(owner, repoName, taskNo);

  try {
    let issueRes = await checkIssue(taskNo);
    if (!issueRes.success) {
      // WIP 标签智能恢复：检查是否为 WIP 阻断且任务实际已停止
      if (issueRes.error.includes("WIP")) {
        const recovered = await tryRecoverFromWip(taskNo, paths);
        if (recovered) {
          // WIP 已清理，重新检查 Issue
          issueRes = await checkIssue(taskNo);
        }
      }
      if (!issueRes.success) {
        sessionManager.markAsError(issueRes.error);
        throw new Error(issueRes.error);
      }
    }
    logger.success("issue检测通过");

    // 将 Issue 数据持久化，供 Agent prompt 直接读取
    paths.ensureDir();
    fs.writeFileSync(paths.getIssueFile(), JSON.stringify(issueRes.data, null, 2));

    const taskRes = checkTask(owner, repoName, taskNo);
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

    const res = await runTask(num, options, sessionManager, paths, owner, repoName);
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

const checkTask = (owner: string, repo: string, taskNo: number) => {
  const task = new Task(owner, repo, taskNo);
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
