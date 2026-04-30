#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import { consola } from 'consola';
import { checkGitRepo, failure, success } from '../core/common';

const logger = consola.withTag('run');

import chalk from 'chalk';
import { config } from '../core/config';
import { readSession } from '../core/db';
import { SessionPathManager } from '../core/session-paths';
import { ensureProjectBootstrap } from '../domain/bootstrap';
import { Issue } from '../domain/issue';
import {
  launchIssueAgent,
  tryRecoverFromStaleLabel,
} from '../domain/issue-agent';
import { handleTriagedIssue, triageIssue } from '../domain/issue-triage';
import { ensureLabelsExist } from '../domain/label-sync';
import { SessionManager } from '../domain/session-manager';
import {
  LIFECYCLE,
  PHASE,
  type SessionPhase,
  STEP,
} from '../domain/session-state-machine';
import { Task } from '../domain/task';
import { get_gh_client, readRepoInfo } from '../integration/github-client';
import { runGc } from './worktree-gc';

/**
 * run - 极简一键启动入口
 * 放在项目根目录，直接 ./run.ts <issue/pr> <number>
 */

import { Command } from 'commander';

const welcome = () => {
  logger.log(chalk.cyan('======================================'));
  logger.log(chalk.bold.cyan(`  ALONG 一键启动 (Bun 版)`));
  logger.log(chalk.cyan('======================================'));
  logger.log('');
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
  logger.success('本地git仓库检测通过');

  const repoResult = await readRepoInfo();
  if (!repoResult.success) return repoResult;
  logger.success('远程git仓库检测通过');

  return success(null);
}

function configureCommand() {
  const program = new Command();
  program
    .name('./run.ts')
    .description(`ALONG 一键启动 (Bun 版)`)
    .version('1.0.0')
    .configureOutput({
      writeErr: (str) => {
        if (str.includes('error: missing required argument')) {
          const arg = str.match(/'(.+)'/)?.[1];
          process.stderr.write(
            `along run缺少必要的参数[${arg}]，例如：along run 42\n`,
          );
        } else if (str.includes('error: unknown option')) {
          const opt = str.match(/'(.+)'/)?.[1] || '选项';
          process.stderr.write(`错误：未知选项 '${opt}'\n`);
        } else {
          process.stderr.write(str);
        }
      },
    })
    .argument('<编号>', 'Issue 编号');

  return program;
}

/**
 * 自动检测执行阶段：
 * - 如果数据库中 planning 已完成（waiting_human）→ 保持 planning（等待 /approve 指令）
 * - 否则 → 返回当前 phase 或默认 planning
 */
async function detectPhase(
  paths: SessionPathManager,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<SessionPhase> {
  // 优先从数据库读取 session 状态
  const sessionRes = readSession(owner, repo, issueNumber);
  if (sessionRes.success && sessionRes.data) {
    const { phase, lifecycle } = sessionRes.data;
    if (phase === PHASE.PLANNING && lifecycle === LIFECYCLE.WAITING_HUMAN) {
      logger.info(
        `Issue #${issueNumber} 处于 waiting_human，保持 planning 阶段（等待 /approve 指令）`,
      );
      return PHASE.PLANNING;
    }
    if (phase) {
      logger.info(`从数据库恢复阶段: ${phase}`);
      return phase;
    }
  }

  // 回退：读取 .along-mode 文件
  const modeFile = path.join(paths.getIssueDir(), '.along-mode');
  try {
    if (fs.existsSync(modeFile)) {
      const current = fs.readFileSync(modeFile, 'utf-8').trim();
      if (
        current === PHASE.PLANNING ||
        current === PHASE.IMPLEMENTATION ||
        current === PHASE.DELIVERY ||
        current === PHASE.STABILIZATION
      ) {
        logger.info(`从 .along-mode 恢复阶段: ${current}`);
        return current;
      }
    }
  } catch {}
  return PHASE.PLANNING;
}

async function handleAction(num: string) {
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
      // running 标签智能恢复：检查是否为 running 阻断且任务实际已停止
      if (issueRes.error.includes(LIFECYCLE.RUNNING)) {
        const recovered = await tryRecoverFromStaleLabel(
          owner,
          repoName,
          taskNo,
        );
        if (recovered) {
          // running 已清理，重新检查 Issue
          issueRes = await checkIssue(taskNo);
        }
      }
      if (!issueRes.success) {
        await sessionManager.markAsError(issueRes.error);
        logger.error(`任务检测失败: ${issueRes.error}`);
        process.exit(1);
      }
    }
    logger.success('issue检测通过');

    // 将 Issue 数据持久化，供 Agent prompt 直接读取
    const ensureRes = paths.ensureDir();
    if (!ensureRes.success) {
      logger.error(ensureRes.error);
      process.exit(1);
    }
    fs.writeFileSync(
      paths.getIssueFile(),
      JSON.stringify(issueRes.data, null, 2),
    );

    const taskRes = checkTask(owner, repoName, taskNo);
    if (!taskRes.success) {
      await sessionManager.markAsError(taskRes.error);
      logger.error(`Task 检查失败: ${taskRes.error}`);
      process.exit(1);
    }
    logger.success('task检测通过');

    await sessionManager.updateStep(
      STEP.READ_ISSUE,
      '正在检查 Git 仓库和 Issue 状态',
    );

    try {
      await runGc({ silent: true });
    } catch {
      /* gc 失败不影响主流程 */
      sessionManager.log('GC failed, but continuing anyway', 'warn');
    }

    await sessionManager.updateStep(STEP.READ_ISSUE, '开始执行任务流程');

    const phase = await detectPhase(paths, owner, repoName, taskNo);
    logger.info(`执行阶段: ${phase}`);

    // AI 分类门控（仅首次 planning 阶段执行）
    if (phase === PHASE.PLANNING) {
      const issueData = issueRes.data;
      if (!issueData) {
        await sessionManager.markAsError('Issue 数据为空，无法继续分类');
        logger.error(`Issue #${taskNo} 数据为空`);
        process.exit(1);
      }
      const issueLabels = (issueData.labels || []).map((l: any) =>
        typeof l === 'string' ? l : l.name,
      );

      const hasActionableLabel = issueLabels.some(
        (l: string) => l === 'bug' || l === 'feature',
      );

      if (!hasActionableLabel) {
        await sessionManager.updateStep(
          STEP.READ_ISSUE,
          '正在对 Issue 进行 AI 分类',
        );
        const triageRes = await triageIssue(
          issueData.title,
          issueData.body || '',
          issueLabels,
        );
        if (!triageRes.success) {
          await sessionManager.markAsError(
            `Issue 分类失败: ${triageRes.error}`,
          );
          logger.error(`Issue #${taskNo} 分类失败: ${triageRes.error}`);
          process.exit(1);
        }

        const triageResult = triageRes.data;
        logger.info(
          `Issue #${taskNo} 分类结果: ${triageResult.classification} (${triageResult.reason})`,
        );

        if (
          triageResult.classification !== 'bug' &&
          triageResult.classification !== 'feature'
        ) {
          await handleTriagedIssue(owner, repoName, taskNo, triageResult);
          logger.info(
            `Issue #${taskNo} 分类为 ${triageResult.classification}，不启动 agent`,
          );
          process.exit(0);
        }

        await handleTriagedIssue(owner, repoName, taskNo, triageResult, {
          skipAgentLaunch: true,
        });
        logger.success('issue分类通过');
      }
    }

    // 直接委托给 launchIssueAgent（处理 worktree、.along-mode、agent 执行）
    const agentRes = await launchIssueAgent(owner, repoName, taskNo, phase, {
      trigger: 'cli',
      taskData: { title: issueRes.data?.title },
    });

    if (!agentRes.success) {
      await sessionManager.markAsError(agentRes.error);
      logger.error(`任务执行失败: ${agentRes.error}`);
      process.exit(1);
    }
  } catch (error: any) {
    const errorMsg = error.message || String(error);
    await sessionManager.markAsCrashed(errorMsg, error.stack);
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

const checkIssue = async (taskNo: number) => {
  const issue = new Issue(taskNo, config);
  const loadRes = await issue.load();

  if (!loadRes.success) return loadRes;

  const healthRes = issue.checkHealth();
  if (!healthRes.success) return healthRes;

  return success(issue.data);
};

async function main() {
  config.ensureDataDirs();
  welcome();

  const envRes = await checkEnv();
  if (!envRes.success) {
    logger.error(envRes.error);
    process.exit(1);
  }

  const bootstrapRes = await ensureProjectBootstrap();
  if (!bootstrapRes.success) {
    logger.warn(bootstrapRes.error);
  }

  // 自动确保 label 已同步（幂等，带内存缓存）
  const clientRes = await get_gh_client();
  if (clientRes.success) {
    const ensureRes = await ensureLabelsExist(clientRes.data);
    if (!ensureRes.success) {
      logger.warn(`Label 同步失败: ${ensureRes.error}`);
    }
  }

  const program = configureCommand();
  program.action(handleAction);
  program.parse();
}

main();
