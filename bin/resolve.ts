#!/usr/bin/env bun
import { $ } from "bun";
import {
  log_info,
  log_error,
  log_success,
  checkGitRepo,
  get_repo_root,
  Result,
} from "./common";
import { success, failure, logger } from "./common";
import { get_gh_client, isNotFoundError } from "./github-client";
import { config } from "./config";
import chalk from "chalk";
import path from "path";
import fs from "fs";

import { Command } from "commander";

async function detectType(num: string): Promise<Result<"issue">> {
  const clientRes = await get_gh_client();
  if (!clientRes.success) return failure(clientRes.error);
  const client = clientRes.data;

  try {
    await client.getIssue(num);
    log_info(`#${num} 是 Issue`);
    return success("issue");
  } catch (e: any) {
    return failure(`无法找到 Issue #${num}，请检查编号是否正确 (${e.message})`);
  }
}

async function checkWorktree(num: string): Promise<Result<string>> {
  const worktreePath = path.join(config.WORKTREE_DIR, `${num}`);
  if (fs.existsSync(worktreePath)) return success(worktreePath);

  const tag = config.getLogTag();
  return failure(`工作空间不存在: ${worktreePath}\n请先初始化工作空间:\n  ${tag}-start ${num}`);
}

async function runPi(worktreePath: string, template: string, num: string) {
  log_success("启动 pi...");
  process.chdir(worktreePath);
  const proc = Bun.spawn(["pi", "--prompt-template", template, num], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  process.exit(await proc.exited);
}

async function main() {
  const program = new Command();
  program
    .name("resolve")
    .description("解决指定的 Issue")
    .argument("<number>", "Issue 编号")
    .parse();

  const [number] = program.args;
  const options = program.opts();
  if (!number) {
    log_error("缺少编号参数");
    process.exit(1);
  }

  const gitResult = await checkGitRepo();
  if (!gitResult.success) {
    log_error(gitResult.error);
    process.exit(1);
  }

  const typeResult = await detectType(number);
  if (!typeResult.success) {
    log_error(typeResult.error);
    process.exit(1);
  }

  const wtResult = await checkWorktree(number);
  if (!wtResult.success) {
    log_error(wtResult.error);
    process.exit(1);
  }

  const promptTemplate = "resolve-github-issue";
  await runPi(wtResult.data, promptTemplate, number);
}

main();
