#!/usr/bin/env bun
import { consola } from "consola";
import {
  checkGitRepo,
  iso_timestamp,
  Result,
  success,
  failure,
} from "./common";

const logger = consola.withTag("issue-status");
import { readRepoInfo } from "./github-client";
import { readSession, upsertSession } from "./db";

import { Command } from "commander";

async function updateStatus(
  owner: string,
  repo: string,
  issueNumber: number,
  status: string,
  message?: string,
  step?: string,
): Promise<Result<null>> {
  const data = readSession(owner, repo, issueNumber);
  if (!data) {
    return failure(`会话状态不存在: ${owner}/${repo}#${issueNumber}`);
  }

  const update: Record<string, any> = {
    status,
    lastUpdate: iso_timestamp(),
  };
  if (message) update.lastMessage = message;
  if (step) update.currentStep = step;

  upsertSession(owner, repo, issueNumber, update);
  return success(null);
}

async function main() {
  const program = new Command();
  program
    .name("issue-status")
    .description("更新 Issue 处理工作空间的状态")
    .argument("<issue-number>", "Issue 编号")
    .argument("<status>", "新的状态 (如 running, completed, error)")
    .argument("[message]", "附加消息")
    .option("--step <step>", "当前执行的步骤名")
    .parse();

  const [issueNumber, status, message] = program.args;
  const { step } = program.opts();

  const gitResult = await checkGitRepo();
  if (!gitResult.success) {
    logger.error(gitResult.error);
    process.exit(1);
  }

  const repoInfoRes = await readRepoInfo();
  if (!repoInfoRes.success) {
    logger.error(repoInfoRes.error);
    process.exit(1);
  }
  const { owner, repo } = repoInfoRes.data;

  logger.info(`更新 Issue #${issueNumber} 状态为: ${status}`);
  const result = await updateStatus(owner, repo, Number(issueNumber), status, message, step);
  if (!result.success) {
    logger.error(result.error);
    process.exit(1);
  }
  logger.success("状态更新成功");
}

main();
