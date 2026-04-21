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
  git,
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
import { launchIssueAgent, tryRecoverFromWip } from "./issue-agent";
import { triageIssue, handleTriagedIssue } from "./issue-triage";
import { readSession } from "./db";
import type { SessionPhase } from "./session-state-machine";

/**
 * run - 极简一键启动入口
 * 放在项目根目录，直接 ./run.ts <issue/pr> <number>
 */

import { Command } from "commander";

// logTag 延迟获取，避免模块加载时 worktree 未就绪导致检测失败
function getLogTag(): Result<string> {
  return config.getLogTag();
}

// Removed redundant functions: identifyTask, ensureWorktree, executeTask, execTmux, tryGetSessionTask, runTask

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

  return success(null);
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
    .option("-d, --detach", "创建 tmux 窗口后，不自动进入该窗口");

  return program;
}

// Removed tryRecoverFromWip (moved to issue-agent.ts)

/**
 * 自动检测执行阶段：
 * - 如果数据库中 planning 已完成（waiting_human）→ 切换到 implementation
 * - 否则 → 返回当前 phase 或默认 planning
 */
function detectPhase(paths: SessionPathManager, owner: string, repo: string, issueNumber: number): SessionPhase {
  // 优先从数据库读取 session 状态
  const sessionRes = readSession(owner, repo, issueNumber);
  if (sessionRes.success && sessionRes.data) {
    const { phase, lifecycle } = sessionRes.data;
    // planning 阶段已完成且等待人工审批 → 下次启动进入 implementation
    if (phase === "planning" && lifecycle === "waiting_human") {
      logger.info("检测到 planning 已完成（等待审批），切换到 implementation");
      return "implementation";
    }
    if (phase) {
      logger.info(`从数据库恢复阶段: ${phase}`);
      return phase;
    }
  }

  // 回退：读取 .along-mode 文件
  const modeFile = path.join(paths.getIssueDir(), ".along-mode");
  try {
    if (fs.existsSync(modeFile)) {
      const current = fs.readFileSync(modeFile, "utf-8").trim() as SessionPhase;
      if (current === "planning" || current === "implementation" || current === "delivery" || current === "stabilization") {
        logger.info(`从 .along-mode 恢复阶段: ${current}`);
        return current;
      }
    }
  } catch {}
  return "planning";
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
        const recovered = await tryRecoverFromWip(owner, repoName, taskNo, paths);
        if (recovered) {
          // WIP 已清理，重新检查 Issue
          issueRes = await checkIssue(taskNo);
        }
      }
      if (!issueRes.success) {
        sessionManager.markAsError(issueRes.error);
        logger.error(`任务检测失败: ${issueRes.error}`);
        process.exit(1);
      }
    }
    logger.success("issue检测通过");

    // 将 Issue 数据持久化，供 Agent prompt 直接读取
    const ensureRes = paths.ensureDir();
    if (!ensureRes.success) {
      logger.error(ensureRes.error);
      process.exit(1);
    }
    fs.writeFileSync(paths.getIssueFile(), JSON.stringify(issueRes.data, null, 2));

    const taskRes = checkTask(owner, repoName, taskNo);
    if (!taskRes.success) {
      sessionManager.markAsError(taskRes.error);
      logger.error(`Task 检查失败: ${taskRes.error}`);
      process.exit(1);
    }
    logger.success("task检测通过");

    sessionManager.writeStatus({ message: "正在检查 Git 仓库和 Issue 状态" });

    try {
      await runGc({ silent: true });
    } catch {
      /* gc 失败不影响主流程 */
      sessionManager.log("GC failed, but continuing anyway", "warn");
    }

    sessionManager.writeStatus({ message: "开始执行任务流程" });

    const phase = detectPhase(paths, owner, repoName, taskNo);
    logger.info(`执行阶段: ${phase}`);

    // AI 分类门控（仅首次 planning 阶段执行）
    if (phase === "planning") {
      const issueData = issueRes.data!;
      const issueLabels = (issueData.labels || []).map((l: any) =>
        typeof l === "string" ? l : l.name
      );

      const hasActionableLabel = issueLabels.some((l: string) =>
        l === "bug" || l === "enhancement"
      );

      if (!hasActionableLabel) {
        sessionManager.writeStatus({ message: "正在对 Issue 进行 AI 分类" });
        const triageRes = await triageIssue(issueData.title, issueData.body || "", issueLabels);
        if (!triageRes.success) {
          sessionManager.markAsError(`Issue 分类失败: ${triageRes.error}`);
          logger.error(`Issue #${taskNo} 分类失败: ${triageRes.error}`);
          process.exit(1);
        }

        const triageResult = triageRes.data;
        logger.info(`Issue #${taskNo} 分类结果: ${triageResult.classification} (${triageResult.reason})`);

        if (triageResult.classification !== "bug" && triageResult.classification !== "feature") {
          await handleTriagedIssue(owner, repoName, taskNo, triageResult);
          logger.info(`Issue #${taskNo} 分类为 ${triageResult.classification}，不启动 agent`);
          process.exit(0);
        }

        await handleTriagedIssue(owner, repoName, taskNo, triageResult, { skipAgentLaunch: true });
        logger.success("issue分类通过");
      }
    }

    // 直接委托给 launchIssueAgent（处理 worktree、.along-mode、agent 执行）
    const agentRes = await launchIssueAgent(owner, repoName, taskNo, phase, {
      strategy: options.ci ? "direct" : "tmux",
      detach: options.detach,
      taskData: { title: issueRes.data.title },
    });

    if (!agentRes.success) {
      sessionManager.markAsError(agentRes.error);
      logger.error(`任务执行失败: ${agentRes.error}`);
      process.exit(1);
    }
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
