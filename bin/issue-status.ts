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
import { SessionPathManager } from "./session-paths";
import fs from "fs";

import { Command } from "commander";

async function updateStatus(statusFile: string, status: string, message?: string, step?: string): Promise<Result<null>> {
  if (!fs.existsSync(statusFile)) {
    return failure(`状态文件不存在: ${statusFile}`);
  }

  const data = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
  data.status = status;
  data.lastUpdate = iso_timestamp();
  if (message) data.lastMessage = message;
  if (step) data.currentStep = step;

  await Bun.write(statusFile, JSON.stringify(data, null, 2));
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
  const paths = new SessionPathManager(owner, repo, Number(issueNumber));
  const statusFile = paths.getStatusFile();

  logger.info(`更新 Issue #${issueNumber} 状态为: ${status}`);
  const result = await updateStatus(statusFile, status, message, step);
  if (!result.success) {
    logger.error(result.error);
    process.exit(1);
  }
  logger.success("状态更新成功");
}

main();
