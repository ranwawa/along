#!/usr/bin/env bun
import { Command } from "commander";
import { get_gh_client } from "./github-client";
import { consola } from "consola";

const logger = consola.withTag("issue-label");

async function main() {
  const program = new Command();
  program
    .name("issue-label")
    .description("给 Issue 添加标签")
    .argument("<issue-number>", "Issue 编号")
    .argument("<labels...>", "要添加的标签列表")
    .parse();

  const [issueNumber] = program.args;
  const labels = program.args.slice(1);

  try {
    const clientRes = await get_gh_client();
    if (!clientRes.success) {
      logger.error(`GitHub 客户端初始化失败: ${clientRes.error}`);
      process.exit(1);
    }

    await clientRes.data.addIssueLabels(issueNumber, labels);
    logger.success(`在 Issue #${issueNumber} 中添加标签成功: ${labels.join(", ")}`);
  } catch (error: any) {
    logger.error(`添加标签失败: ${error.message}`);
    process.exit(1);
  }
}

main();
