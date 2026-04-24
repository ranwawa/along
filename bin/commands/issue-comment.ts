#!/usr/bin/env bun
import { Command } from "commander";
import { get_gh_client, readRepoInfo } from "../integration/github-client";
import { consola } from "consola";

const logger = consola.withTag("issue-comment");
import { saveStepOutput, completeTodoStep } from "../domain/todo-helper";
import { SessionPathManager } from "../core/session-paths";
import { SessionManager } from "../domain/session-manager";
import {
  isSystemPlanningComment,
  mirrorIssueComment,
  recordPlanningAgentComment,
} from "../domain/planning-state";

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
  const commentBody = String(message || "");
  const issueNo = Number(issueNumber);

  const clientRes = await get_gh_client();
  if (!clientRes.success) {
    logger.error(`GitHub 客户端初始化失败: ${clientRes.error}`);
    process.exit(1);
  }

  const commentRes = await clientRes.data.addIssueComment(issueNumber, commentBody);
  if (!commentRes.success) {
    // 尝试写入 session.log
    const repoInfoRes = await readRepoInfo();
    if (repoInfoRes.success) {
      const { owner, repo } = repoInfoRes.data;
      const session = new SessionManager(owner, repo, issueNo);
      session.log(`issue-comment 失败: ${commentRes.error}`, "error");
    }
    logger.error(`发表评论失败: ${commentRes.error}`);
    process.exit(1);
  }
  logger.success(`在 Issue #${issueNumber} 中发表评论成功`);

  const repoInfoRes = await readRepoInfo();
  if (!repoInfoRes.success) {
    logger.error(`读取仓库信息失败: ${repoInfoRes.error}`);
    process.exit(1);
  }

  const { owner, repo } = repoInfoRes.data;
  const paths = new SessionPathManager(owner, repo, issueNo);
  const session = new SessionManager(owner, repo, issueNo);

  if (isSystemPlanningComment(commentBody)) {
    const mirrorRes = mirrorIssueComment({
      owner,
      repo,
      issueNumber: issueNo,
      commentId: commentRes.data.commentId,
      authorLogin: "along-system[bot]",
      senderType: "Bot",
      body: commentBody,
      createdAt: commentRes.data.createdAt,
    });
    if (!mirrorRes.success) {
      session.log(`issue-comment 镜像失败: ${mirrorRes.error}`, "error");
      logger.error(`同步 planning comment 失败: ${mirrorRes.error}`);
      process.exit(1);
    }

    const planningRes = recordPlanningAgentComment({
      owner,
      repo,
      issueNumber: issueNo,
      commentId: commentRes.data.commentId,
      body: commentBody,
      createdAt: commentRes.data.createdAt,
    });
    if (!planningRes.success) {
      session.log(`issue-comment 收敛失败: ${planningRes.error}`, "error");
      logger.error(`同步 planning comment 失败: ${planningRes.error}`);
      process.exit(1);
    }
  }

  session.logEvent("issue-comment-posted", {
    issueNumber,
    commentId: commentRes.data.commentId,
    messageLength: commentBody.length,
  });

  // 如果指定了 --step，自动更新 todo
  if (opts.step) {
    const stepNum = parseInt(opts.step, 10);
    const outputContent = [
      `# 第${opts.step}步：Issue 评论`,
      ``,
      `- **Issue**: #${issueNumber}`,
      `- **Comment ID**: ${commentRes.data.commentId}`,
      ``,
      `## 评论内容`,
      ``,
      commentBody,
    ].join("\n");
    const outputFile = saveStepOutput(paths, stepNum, "issue-comment", outputContent);
    completeTodoStep(paths, stepNum, "已同步计划到 Issue 评论", outputFile);
  }
}

main();
