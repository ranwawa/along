#!/usr/bin/env bun
import { Command } from "commander";
import fs from "fs";
import { consola } from "consola";
import { git, iso_timestamp } from "./common";
import { readRepoInfo } from "./github-client";

const logger = consola.withTag("branch-create");
import { saveStepOutput, completeTodoStep } from "./todo-helper";
import { SessionPathManager } from "./session-paths";
import { SessionManager } from "./session-manager";

/**
 * branch-create.ts - 创建语义化分支
 *
 * 在 worktree 内执行：
 * 1. git checkout -B <branch-name>
 * 2. git push -u origin <branch-name>
 * 3. 更新数据库中的 context.branchName
 */

async function main() {
  const program = new Command();
  program
    .name("branch-create")
    .description("创建语义化分支")
    .argument("<issue-number>", "Issue 编号")
    .argument("<branch-name>", "分支名称（需符合 branch-naming SKILL 规范）")
    .parse();

  const [issueNumber, branchName] = program.args;

  if (!issueNumber || !branchName) {
    logger.error("缺少必要参数: issue-number 和 branch-name");
    process.exit(1);
  }

  const repoInfoRes = await readRepoInfo();
  if (!repoInfoRes.success) {
    logger.error(repoInfoRes.error);
    process.exit(1);
  }
  const { owner, repo } = repoInfoRes.data;
  const paths = new SessionPathManager(owner, repo, Number(issueNumber));
  const session = new SessionManager(owner, repo, Number(issueNumber));

  const worktreePath = paths.getWorktreeDir();
  if (!fs.existsSync(worktreePath)) {
    logger.error(`工作目录不存在: ${worktreePath}`);
    process.exit(1);
  }

  try {
    // 1. 在 worktree 中切换到新分支
    logger.info(`创建分支: ${branchName}`);
    const wtGit = git.cwd(worktreePath);
    await wtGit.checkout(["-B", branchName]);
    logger.success(`分支已创建: ${branchName}`);
    session.logEvent("branch-created", { branchName });

    // 2. 推送并关联远程分支
    logger.info("推送分支到远端...");
    await wtGit.push(["--set-upstream", "origin", branchName]);
    logger.success("分支已推送到远端");
    session.logEvent("branch-pushed", { branchName });

    // 3. 更新数据库：写入 branchName + 自动推进 step
    const currentRes = session.readStatus();
    const writeRes = session.writeStatus({
      context: {
        ...(currentRes.success && currentRes.data?.context ? currentRes.data.context : { issueNumber: Number(issueNumber) }),
        branchName,
      },
    });
    if (writeRes.success) {
      session.transition({ type: "BRANCH_PREPARED", branchName });
    }
    if (!writeRes.success) {
      logger.error(`更新分支状态失败: ${writeRes.error}`);
      process.exit(1);
    }
    logger.success("状态已更新");

    // 4. 自动更新 todo
    const outputContent = [
      `# 第一步：创建语义化分支`,
      ``,
      `- **分支名**: ${branchName}`,
      `- **Issue**: #${issueNumber}`,
      `- **远程推送**: 已完成`,
    ].join("\n");
    const outputFile = saveStepOutput(paths, 1, "branch-create", outputContent);
    completeTodoStep(paths, 1, `分支: ${branchName}`, outputFile);

    logger.success(`分支 ${branchName} 创建完成`);
  } catch (error: any) {
    session.log(`branch-create 失败: ${error.message}\n${error.stack || ""}`, "error");
    logger.error(`分支创建失败: ${error.message}`);
    process.exit(1);
  }
}

main();
