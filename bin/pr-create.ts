#!/usr/bin/env bun
import { $ } from "bun";
import { Command } from "commander";
import fs from "fs";
import path from "path";
import { consola } from "consola";
import { iso_timestamp } from "./common";

const logger = consola.withTag("pr-create");
import { config } from "./config";
import { getDefaultBranch } from "./worktree-init";
import { saveStepOutput, completeTodoStep } from "./todo-helper";

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

  const statusFile = path.join(config.SESSION_DIR, `${issueNumber}-status.json`);
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

  const worktreePath = path.join(config.WORKTREE_DIR, `${issueNumber}`);

  try {
    const defaultBranch = await getDefaultBranch();
    logger.info(`创建 PR: ${branchName} -> ${defaultBranch}`);

    const result = await $`gh pr create \
      --repo ${repo.owner}/${repo.name} \
      --head ${branchName} \
      --base ${defaultBranch} \
      --title ${title} \
      --body ${body}`.cwd(worktreePath).text();

    const prUrl = result.trim();
    logger.success(`PR 创建成功: ${prUrl}`);

    // 自动更新 status.json：记录 PR URL，保持 running 状态
    statusData.prUrl = prUrl;
    statusData.lastUpdate = iso_timestamp();
    statusData.lastMessage = "PR 已创建";
    statusData.currentStep = "等待 PR 审核与合并";
    fs.writeFileSync(statusFile, JSON.stringify(statusData, null, 2));

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
    const outputFile = saveStepOutput(issueNumber, 5, "pr-create", outputContent);
    completeTodoStep(issueNumber, 5, `PR: ${prUrl}`, outputFile);
  } catch (error: any) {
    logger.error(`PR 创建失败: ${error.message}`);
    process.exit(1);
  }
}

main();
