#!/usr/bin/env bun
import { consola } from "consola";

const logger = consola.withTag("cleanup");
import { config } from "./config";
import { checkAndKillProcess, cleanupIssue } from "./cleanup-utils";
import { readRepoInfo } from "./github-client";
import { SessionPathManager } from "./session-paths";

import { Command } from "commander";

async function main() {
  const program = new Command();
  program
    .name("issue-cleanup")
    .description("清理 Issue 处理工作空间和状态")
    .argument("<issue-number>", "Issue 编号")
    .option("-f, --force", "强制清理，即使进程正在运行", false)
    .parse();

  const [issueNumber] = program.args;
  const { force } = program.opts();

  const repoInfoRes = await readRepoInfo();
  if (!repoInfoRes.success) {
    logger.error(repoInfoRes.error);
    process.exit(1);
  }
  const { owner, repo } = repoInfoRes.data;
  const paths = new SessionPathManager(owner, repo, Number(issueNumber));
  const statusFile = paths.getStatusFile();

  logger.info(`清理 Issue #${issueNumber}...`);

  const { canProceed, error } = await checkAndKillProcess(statusFile, issueNumber, { force });
  if (!canProceed) {
    logger.error(error!);
    process.exit(1);
  }

  await cleanupIssue(issueNumber, { force, reason: force ? "force" : "normal" }, owner, repo);

  logger.success(`Issue #${issueNumber} 清理完成`);
}

main();
