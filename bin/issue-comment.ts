#!/usr/bin/env bun
import { Command } from "commander";
import { get_gh_client } from "./github-client";
import { log_info, log_error, log_success } from "./common";
import { saveStepOutput, completeTodoStep } from "./todo-helper";

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

  try {
    const clientRes = await get_gh_client();
    if (!clientRes.success) {
      log_error(`GitHub 客户端初始化失败: ${clientRes.error}`);
      process.exit(1);
    }

    await clientRes.data.addIssueComment(issueNumber, message);
    log_success(`在 Issue #${issueNumber} 中发表评论成功`);

    // 如果指定了 --step，自动更新 todo
    if (opts.step) {
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
      const outputFile = saveStepOutput(issueNumber, stepNum, "issue-comment", outputContent);
      completeTodoStep(issueNumber, stepNum, "已同步计划到 Issue 评论", outputFile);
    }
  } catch (error: any) {
    log_error(`发表评论失败: ${error.message}`);
    process.exit(1);
  }
}

main();
