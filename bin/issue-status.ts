#!/usr/bin/env bun
import { consola } from "consola";
import {
  checkGitRepo,
  iso_timestamp,
  Result,
  success,
  failure,
} from "./common";
const VALID_LIFECYCLES: Set<string> = new Set<string>([
  "running",
  "waiting_human",
  "waiting_external",
  "completed",
  "failed",
  "interrupted",
]);

const logger = consola.withTag("issue-status");
import { readRepoInfo } from "./github-client";
import { readSession, upsertSession } from "./db";

import { Command } from "commander";

async function updateStatus(
  owner: string,
  repo: string,
  issueNumber: number,
  lifecycle: string,
  message?: string,
  step?: string,
): Promise<Result<null>> {
  const res = readSession(owner, repo, issueNumber);
  if (!res.success) {
    return failure(`读取会话状态失败: ${res.error}`);
  }
  if (!res.data) {
    return failure(`会话状态不存在: ${owner}/${repo}#${issueNumber}`);
  }

  const update: Record<string, any> = {
    lifecycle,
    lastUpdate: iso_timestamp(),
  };
  if (message) update.message = message;
  if (step) update.step = step;

  const upRes = upsertSession(owner, repo, issueNumber, update);
  if (!upRes.success) {
    return failure(`更新会话状态失败: ${upRes.error}`);
  }
  return success(null);
}

async function main() {
  const program = new Command();
  program
    .name("issue-status")
    .description("更新 Issue 处理工作空间的状态")
    .argument("<issue-number>", "Issue 编号")
    .argument("<status>", "新的 lifecycle (如 running, completed, failed)")
    .argument("[message]", "附加消息")
    .option("--step <step>", "当前执行的步骤名")
    .parse();

  const [issueNumber, status, message] = program.args;
  const { step } = program.opts();

  if (!VALID_LIFECYCLES.has(status)) {
    logger.error(`无效的 lifecycle 值: "${status}". 合法值: ${[...VALID_LIFECYCLES].join(", ")}`);
    process.exit(1);
  }

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
