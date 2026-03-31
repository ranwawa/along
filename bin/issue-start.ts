#!/usr/bin/env bun
import {
  log_info,
  log_error,
  log_warn,
  log_success,
  logger,
  success,
  failure,
  checkGitRepo,
  get_repo_root,
  iso_timestamp,
  git,
} from "./common";
import { checkGithubAuth, get_gh_client, readRepoInfo } from "./github-client";
import type { Result } from "./common";
import type { GitHubIssue } from "./github-client";
import { simpleGit } from "simple-git";
import chalk from "chalk";
import { config } from "./config";
import path from "path";
import fs from "fs";
import { Issue } from "./issue";

import { Command } from "commander";

async function checkExistingSession(statusFile: string, issueNumber: string): Promise<Result<null>> {
  if (!fs.existsSync(statusFile)) return success(null);
  const data = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
  if (data.status !== "running") return success(null);

  const tag = config.getLogTag();
  const msg = `Issue #${issueNumber} 已在处理中 (状态: ${chalk.yellow("running")})\n工作目录: ${chalk.dim(data.worktreePath || "未知")}\n如需强制重新开始，请先执行: ${chalk.cyan(`${tag}-cleanup ${issueNumber}`)}`;
  return failure(msg);
}

async function getIssueData(issueNumber: string, dataOption?: string): Promise<Result<any>> {
  const issue = new Issue(Number.parseInt(issueNumber, 10), config);

  if (dataOption) {
    try {
      const data = JSON.parse(dataOption);
      issue.data = data;
      return success(data);
    } catch {
      log_warn("解析预抓取数据失败，将从 GitHub 获取");
    }
  }

  log_info(`获取 Issue #${issueNumber} 详情...`);
  const loadRes = await issue.load();
  if (!loadRes.success) return failure(loadRes.error);

  const healthRes = issue.checkHealth();
  if (!healthRes.success) return failure(healthRes.error);

  return success(issue.data);
}

function getBranchName(issueNumber: string, issueTitle: string, suffix: string) {
  const titleSlug = issueTitle
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 30);
  return `feat/${issueNumber}-${titleSlug || "task"}-${suffix}`;
}

async function setupWorktree(worktreePath: string, branchName: string): Promise<Result<null>> {
  if (fs.existsSync(worktreePath)) {
    if (fs.existsSync(path.join(worktreePath, ".along/issue-mark"))) return success(null);
    return failure(`工作目录存在但非本工具创建，请手动检查: ${worktreePath}`);
  }

  log_info("创建 worktree...");
  try {
    await git.fetch("origin", "master");
    await git.raw(["worktree", "add", worktreePath, "-B", branchName, "origin/master"]);
  } catch (e: any) {
    return failure(`创建 worktree 失败: ${e.message}`);
  }

  return success(null);
}

async function initSessionFiles(worktreePath: string, issueNumber: string, statusFile: string, statusData: any, todoFile: string) {
  // 1. 创建 .along 并标记
  fs.mkdirSync(path.join(worktreePath, ".along"), { recursive: true });
  fs.writeFileSync(path.join(worktreePath, ".along/issue-mark"), issueNumber);

  // 2. 自动环境同步 (软链编辑器配置)
  // 只要主仓库根目录存在 .opencode 或 .pi，就在 worktree 里建立同名软链
  const repoRoot = process.cwd();
  for (const editor of config.EDITORS) {
    const rootEditorDir = path.join(repoRoot, `.${editor.id}`);
    const wtEditorDir = path.join(worktreePath, `.${editor.id}`);
    
    if (fs.existsSync(rootEditorDir)) {
      try {
        // 使用相对路径建立软链，增加可移植性
        const target = path.relative(path.dirname(wtEditorDir), rootEditorDir);
        fs.symlinkSync(target, wtEditorDir, "dir");
        log_info(`  已同步编辑器环境: ${chalk.cyan(`.${editor.id}`)}`);
      } catch (e: any) {
        log_warn(`  同步编辑器环境失败 (${editor.id}): ${e.message}`);
      }
    }
  }

  log_info("创建状态文件...");
  fs.mkdirSync(path.dirname(statusFile), { recursive: true });
  fs.writeFileSync(statusFile, JSON.stringify(statusData, null, 2));

  log_info("创建初始 todo 文件...");
  const todoContent = `- [ ] 第一步：获取 Issue 上下文\n- [ ] 第二步：分析代码库\n- [ ] 第三步：制定实施计划\n- [ ] 第四步：实施修复\n- [ ] 第五步：质量门禁检查\n- [ ] 第六步：提交并创建 PR\n`;
  fs.writeFileSync(todoFile, todoContent);
}

function printSummary(issueNumber: string, issueTitle: string, branchName: string, worktreePath: string, statusFile: string, todoFile: string) {
  const isFromRun = process.argv.includes("--skip-checks");
  if (isFromRun) {
    log_success(`Issue #${issueNumber} 工作空间准备就绪`);
    return;
  }

  log_success("初始化完成！\n");
  logger.log(chalk.cyan("====================================="));
  logger.log(chalk.bold(`Issue: #${issueNumber} - ${issueTitle}`));
  logger.log(`分支: ${chalk.yellow(branchName)}`);
  logger.log(`工作目录: ${chalk.dim(worktreePath)}`);
  logger.log(chalk.cyan("====================================="));
  const tag = config.getLogTag();
  const editor = config.EDITORS.find(e => e.id === tag);
  const repoRoot = get_repo_root();
  logger.info(`\n下一步建议：直接在项目根目录运行自动集成命令:`);
  logger.info(`  ${chalk.cyan(`./run.ts ${issueNumber}`)}\n`);
}

async function main() {
  const program = new Command();
  program
    .name("issue-start")
    .description("初始化 Issue 处理工作空间")
    .argument("<issue-number>", "Issue 编号")
    .argument("[branch-suffix]", "分支名称后缀")
    .option("--data <json>", "预抓取的 Issue JSON 数据")
    .option("--skip-checks", "跳过基础环境检查")
    .parse();

  const [issueNumber, branchSuffixInput] = program.args;
  const { data: dataOption, skipChecks } = program.opts();
  const branchSuffix = branchSuffixInput || Math.floor(Date.now() / 1000).toString();

  if (!skipChecks) {
    const ghResult = await checkGithubAuth();
    if (!ghResult.success) {
      log_error(ghResult.error);
      process.exit(1);
    }

    const gitResult = await checkGitRepo();
    if (!gitResult.success) {
      log_error(gitResult.error);
      process.exit(1);
    }
  }

  const repoRoot = await get_repo_root();
  const statusFile = path.join(config.SESSION_DIR, `${issueNumber}-status.json`);
  const todoFile = path.join(config.SESSION_DIR, `${issueNumber}-todo.md`);

  const existingResult = await checkExistingSession(statusFile, issueNumber);
  if (!existingResult.success) {
    log_error(existingResult.error);
    process.exit(1);
  }

  const dataResult = await getIssueData(issueNumber, dataOption);
  if (!dataResult.success) {
    log_error(dataResult.error);
    process.exit(1);
  }
  const issueData = dataResult.data;


  const branchName = getBranchName(issueNumber, issueData.title, branchSuffix);
  const worktreePath = path.join(config.WORKTREE_DIR, `${issueNumber}`);
  const wtResult = await setupWorktree(worktreePath, branchName);
  if (!wtResult.success) {
    log_error(wtResult.error);
    process.exit(1);
  }

  const repoInfoRes = await readRepoInfo(true);
  if (!repoInfoRes.success) {
    log_error(repoInfoRes.error);
    process.exit(1);
  }
  const { owner, repo: repoName } = repoInfoRes.data;

  const statusData = {
    issueNumber: Number(issueNumber),
    status: "running",
    startTime: iso_timestamp(),
    branchName,
    worktreePath,
    title: issueData.title,
    repo: { owner, name: repoName },
  };

  await initSessionFiles(worktreePath, issueNumber, statusFile, statusData, todoFile);
  printSummary(issueNumber, issueData.title, branchName, worktreePath, statusFile, todoFile);
}

main();
