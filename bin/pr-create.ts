#!/usr/bin/env bun
import { $ } from "bun";
import { Command } from "commander";
import fs from "fs";
import { consola } from "consola";
import { iso_timestamp } from "./common";

const logger = consola.withTag("pr-create");
import { readRepoInfo, readGithubToken } from "./github-client";
import { getDefaultBranch } from "./worktree-init";
import { saveStepOutput, completeTodoStep } from "./todo-helper";
import { SessionPathManager } from "./session-paths";
import { SessionManager } from "./session-manager";

/**
 * pr-create.ts - 创建 Pull Request
 *
 * 读取 status.json 获取分支和仓库信息，通过 gh CLI 创建 PR。
 * 不移除 WIP 标签（WIP 在 PR 合并到默认分支后才移除）。
 */

async function main() {
  const program = new Command();
  program
    .name("pr-create")
    .description("创建 Pull Request")
    .argument("<issue-number>", "Issue 编号")
    .argument("<title>", "PR 标题")
    .argument("<body>", "PR 详细描述")
    .parse();

  const [issueNumber, title, body] = program.args;

  if (!issueNumber || !title || !body) {
    logger.error("缺少必要参数: issue-number, title, body");
    process.exit(1);
  }

  const repoInfoRes = await readRepoInfo();
  if (!repoInfoRes.success) {
    logger.error(repoInfoRes.error);
    process.exit(1);
  }
  const { owner, repo: repoName } = repoInfoRes.data;
  const paths = new SessionPathManager(owner, repoName, Number(issueNumber));
  const session = new SessionManager(owner, repoName, Number(issueNumber));

  const statusFile = paths.getStatusFile();
  if (!fs.existsSync(statusFile)) {
    logger.error(`状态文件不存在: ${statusFile}`);
    process.exit(1);
  }

  const statusData = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
  const branchName = statusData.branchName;
  const repo = statusData.repo;

  if (!branchName) {
    logger.error("状态文件中缺少 branchName，请先执行 branch-create");
    process.exit(1);
  }

  if (!repo?.owner || !repo?.name) {
    logger.error("状态文件中缺少仓库信息");
    process.exit(1);
  }

  const worktreePath = paths.getWorktreeDir();

  try {
    const defaultBranch = await getDefaultBranch();
    logger.info(`创建 PR: ${branchName} -> ${defaultBranch}`);

    // 使用当前认证 token（可能是 agent 角色 token）确保 gh CLI 使用正确身份
    const tokenRes = await readGithubToken();
    const ghEnv = tokenRes.success
      ? { ...process.env, GH_TOKEN: tokenRes.data }
      : { ...process.env };

    const result = await $`gh pr create \
      --repo ${repo.owner}/${repo.name} \
      --head ${branchName} \
      --base ${defaultBranch} \
      --title ${title} \
      --body ${body}`.cwd(worktreePath).env(ghEnv).text();

    const prUrl = result.trim();
    logger.success(`PR 创建成功: ${prUrl}`);

    // 提取 PR number
    const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
    const prNum = prNumberMatch ? Number(prNumberMatch[1]) : undefined;

    // 自动更新 status.json：记录 PR URL，保持 running 状态
    statusData.prUrl = prUrl;
    statusData.lastUpdate = iso_timestamp();
    statusData.lastMessage = "PR 已创建";
    statusData.currentStep = "等待 PR 审核与合并";
    if (prNum) statusData.prNumber = prNum;
    fs.writeFileSync(statusFile, JSON.stringify(statusData, null, 2));

    // 记录到 session.log
    session.logEvent("pr-created", {
      prUrl,
      prNumber: prNum,
      title,
      branchName,
    });

    // 输出 PR URL 供模型使用
    console.log(prUrl);

    // 自动更新 todo
    const outputContent = [
      `# 第五步：创建 PR`,
      ``,
      `- **PR URL**: ${prUrl}`,
      `- **标题**: ${title}`,
      `- **分支**: ${branchName} -> ${defaultBranch}`,
      ``,
      `## PR 描述`,
      ``,
      body,
    ].join("\n");
    const outputFile = saveStepOutput(paths, 5, "pr-create", outputContent);
    completeTodoStep(paths, 5, `PR: ${prUrl}`, outputFile);

    // PR 创建成功后，自动启动 pr-watch 监控 CI 状态和 PR 评论
    await startPrWatch(issueNumber);
  } catch (error: any) {
    session.log(`pr-create 失败: ${error.message}\n${error.stack || ""}`, "error");
    logger.error(`PR 创建失败: ${error.message}`);
    process.exit(1);
  }
}

async function startPrWatch(issueNumber: string): Promise<void> {
  const inTmux = !!process.env.TMUX;

  if (!inTmux) {
    logger.info("未检测到 tmux 环境，跳过自动启动 pr-watch");
    logger.info(`请手动执行: along pr-watch ${issueNumber}`);
    return;
  }

  const windowName = `pr-watch-${issueNumber}`;

  try {
    // 检查是否已有同名窗口在运行
    const windows = await $`tmux list-windows -F '#{window_name}'`.text();
    if (windows.split("\n").some((w) => w.trim() === windowName)) {
      logger.info(`pr-watch 窗口已存在: ${windowName}，跳过重复启动`);
      return;
    }

    await $`tmux new-window -d -n ${windowName} along pr-watch ${issueNumber}`;
    logger.success(`已自动启动 CI 监控: tmux 窗口 ${windowName}`);
  } catch (error: any) {
    logger.warn(`自动启动 pr-watch 失败: ${error.message}`);
    logger.info(`请手动执行: along pr-watch ${issueNumber}`);
  }
}

main();
