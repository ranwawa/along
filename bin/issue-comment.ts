#!/usr/bin/env bun
import { Command } from "commander";
import { get_gh_client, readRepoInfo } from "./github-client";
import { consola } from "consola";

const logger = consola.withTag("issue-comment");
import { saveStepOutput, completeTodoStep } from "./todo-helper";
import { SessionPathManager } from "./session-paths";
import { SessionManager } from "./session-manager";

async function main() {
  const program = new Command();
  program
    .name("issue-comment")
    .description("在 Issue 中发表评论")
    .argument("<issue-number>", "Issue 编号")
    .argument("<message>", "评论内容")
    .option("--step <number>", "关联的 todo 步骤编号（传入时自动更新 todo）")
    .parse();

  const [issueNumber, message] = program.args;
  const opts = program.opts();

  const clientRes = await get_gh_client();
  if (!clientRes.success) {
    logger.error(`GitHub 客户端初始化失败: ${clientRes.error}`);
    process.exit(1);
  }

  const commentRes = await clientRes.data.addIssueComment(issueNumber, message);
  if (!commentRes.success) {
    // 尝试写入 session.log
    const repoInfoRes = await readRepoInfo();
    if (repoInfoRes.success) {
      const { owner, repo } = repoInfoRes.data;
      const session = new SessionManager(owner, repo, Number(issueNumber));
      session.log(`issue-comment 失败: ${commentRes.error}`, "error");
    }
    logger.error(`发表评论失败: ${commentRes.error}`);
    process.exit(1);
  }
  logger.success(`在 Issue #${issueNumber} 中发表评论成功`);

  // 如果指定了 --step，自动更新 todo
  if (opts.step) {
    const repoInfoRes = await readRepoInfo();
    if (!repoInfoRes.success) {
      logger.warn(`无法获取仓库信息，跳过 todo 更新: ${repoInfoRes.error}`);
      return;
    }
    const { owner, repo } = repoInfoRes.data;
    const paths = new SessionPathManager(owner, repo, Number(issueNumber));
    const session = new SessionManager(owner, repo, Number(issueNumber));

    session.logEvent("issue-comment-posted", { issueNumber, messageLength: message.length });

    const stepNum = parseInt(opts.step, 10);
    const outputContent = [
      `# 第${opts.step}步：Issue 评论`,
      ``,
      `- **Issue**: #${issueNumber}`,
      ``,
      `## 评论内容`,
      ``,
      message,
    ].join("\n");
    const outputFile = saveStepOutput(paths, stepNum, "issue-comment", outputContent);
    completeTodoStep(paths, stepNum, "已同步计划到 Issue 评论", outputFile);
  }
}

main();
