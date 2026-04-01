#!/usr/bin/env bun
import { Command } from "commander";
import fs from "fs";
import path from "path";
import { consola } from "consola";
import { git, iso_timestamp } from "./common";
import { get_gh_client } from "./github-client";
import { config } from "./config";

const logger = consola.withTag("branch-create");
import { saveStepOutput, completeTodoStep } from "./todo-helper";

/**
 * branch-create.ts - 创建语义化分支并标记 WIP
 *
 * 在 worktree 内执行：
 * 1. git checkout -B <branch-name>
 * 2. git push -u origin <branch-name>
 * 3. 给 Issue 打 WIP 标签
 * 4. 更新 status.json 中的 branchName
 */

async function main() {
  const program = new Command();
  program
    .name("branch-create")
    .description("创建语义化分支并标记 WIP")
    .argument("<issue-number>", "Issue 编号")
    .argument("<branch-name>", "分支名称（需符合 branch-naming SKILL 规范）")
    .parse();

  const [issueNumber, branchName] = program.args;

  if (!issueNumber || !branchName) {
    logger.error("缺少必要参数: issue-number 和 branch-name");
    process.exit(1);
  }

  const worktreePath = path.join(config.WORKTREE_DIR, `${issueNumber}`);
  if (!fs.existsSync(worktreePath)) {
    logger.error(`工作目录不存在: ${worktreePath}`);
    process.exit(1);
  }

  const statusFile = path.join(config.SESSION_DIR, `${issueNumber}-status.json`);

  try {
    // 1. 在 worktree 中切换到新分支
    logger.info(`创建分支: ${branchName}`);
    const wtGit = git.cwd(worktreePath);
    await wtGit.checkout(["-B", branchName]);
    logger.success(`分支已创建: ${branchName}`);

    // 2. 推送并关联远程分支
    logger.info("推送分支到远端...");
    await wtGit.push(["--set-upstream", "origin", branchName]);
    logger.success("分支已推送到远端");

    // 3. 给 Issue 打 WIP 标签
    logger.info("标记 Issue 为 WIP...");
    const clientRes = await get_gh_client();
    if (!clientRes.success) {
      logger.error(`GitHub 客户端初始化失败: ${clientRes.error}`);
      process.exit(1);
    }
    await clientRes.data.addIssueLabels(issueNumber, ["WIP"]);
    logger.success(`Issue #${issueNumber} 已标记 WIP`);

    // 4. 更新 status.json：写入 branchName + 自动推进 step
    if (fs.existsSync(statusFile)) {
      const data = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
      data.branchName = branchName;
      data.lastUpdate = iso_timestamp();
      data.lastMessage = "已创建语义化分支";
      data.currentStep = "分析代码库并制定实施计划";
      fs.writeFileSync(statusFile, JSON.stringify(data, null, 2));
      logger.success("状态文件已更新");
    }

    // 5. 自动更新 todo
    const outputContent = [
      `# 第一步：创建语义化分支`,
      ``,
      `- **分支名**: ${branchName}`,
      `- **Issue**: #${issueNumber}`,
      `- **WIP 标签**: 已添加`,
      `- **远程推送**: 已完成`,
    ].join("\n");
    const outputFile = saveStepOutput(issueNumber, 1, "branch-create", outputContent);
    completeTodoStep(issueNumber, 1, `分支: ${branchName}`, outputFile);

    logger.success(`分支 ${branchName} 创建完成，Issue #${issueNumber} 已标记 WIP`);
  } catch (error: any) {
    logger.error(`分支创建失败: ${error.message}`);
    process.exit(1);
  }
}

main();
