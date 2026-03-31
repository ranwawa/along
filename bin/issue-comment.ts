#!/usr/bin/env bun
import { Command } from "commander";
import { get_gh_client } from "./github-client";
import { log_info, log_error, log_success } from "./common";

async function main() {
  const program = new Command();
  program
    .name("issue-comment")
    .description("在 Issue 中发表评论")
    .argument("<issue-number>", "Issue 编号")
    .argument("<message>", "评论内容")
    .parse();

  const [issueNumber, message] = program.args;

  try {
    const clientRes = await get_gh_client();
    if (!clientRes.success) {
      log_error(`GitHub 客户端初始化失败: ${clientRes.error}`);
      process.exit(1);
    }

    await clientRes.data.addIssueComment(issueNumber, message);
    log_success(`在 Issue #${issueNumber} 中发表评论成功`);
  } catch (error: any) {
    log_error(`发表评论失败: ${error.message}`);
    process.exit(1);
  }
}

main();
