#!/usr/bin/env bun
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { Command } from "commander";
import { $ } from "bun";
import { log_info, log_error, log_success, git } from "./common";
import { runCommand } from "./exec";
import chalk from "chalk";

/**
 * .along/bin/commit-push.ts
 * 进行原子化提交并推送到远端
 */

interface Commit {
  message: string;
  files: string[];
}

async function main() {
  const program = new Command();
  program
    .name("commit-push")
    .description("将变更进行原子化 Commit 并推送到远端")
    .option("-m, --message <msg>", "提交信息 (单次提交模式)")
    .option("-f, --files <files...>", "提交文件列表 (单次提交模式)")
    .option("-j, --json <json>", "原子化提交列表 JSON 字符串 (高级模式)")
    .parse();

  const opts = program.opts();
  let commits: Commit[] = [];

  if (opts.json) {
    try {
      commits = JSON.parse(opts.json);
    } catch (e) {
      log_error("解析 --json 失败，请检查格式");
      process.exit(1);
    }
  } else if (opts.message && opts.files) {
    commits = [{ message: opts.message, files: opts.files }];
  } else {
    log_error("必须提供 --message 和 --files，或者提供 --json");
    program.help();
    process.exit(1);
  }

  try {
    const currentBranch = runCommand("git branch --show-current");
    const status = runCommand("git status --porcelain");

    // 清理当前暂存区
    runCommand("git reset");

    if (!status && commits.length > 0) {
       // 检查是否已经提交了 (如果有 commits 但 status 为空，可能是已经 commit 过了，但没 push)
       // 但通常我们会根据 status 来判断是否有新变更
    }

    if (!status) {
       log_info("未检测到任何待提交的变更");
    } else {
      for (const commit of commits) {
        if (!commit.files || commit.files.length === 0) continue;

        for (const file of commit.files) {
           await git.add(file);
        }

        const tempMsgFile = path.join(os.tmpdir(), `along-commit-msg-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.txt`);
        fs.writeFileSync(tempMsgFile, commit.message, "utf-8");
        try {
          await git.raw(["commit", "-F", tempMsgFile]);
        } finally {
          if (fs.existsSync(tempMsgFile)) {
            fs.unlinkSync(tempMsgFile);
          }
        }
      }
    }

    // 2. 检查是否还有未提交的变更
    const remainingStatus = runCommand("git status --porcelain");
    if (remainingStatus) {
        log_error(
            `检测到尚有未提交的变更 (Uncommitted changes detected):\n${remainingStatus}\n\n` +
            `[🚨 警告] 如果这些是你在处理任务时生成的临时脚本、测试文件或备注日志（如 .sh, .py, .txt 等），请使用 rm 命令将它们删除！绝对不要将它们提交到代码库中。\n` +
            `如果这些是业务需要的常规代码变更，请将其加入提交列表后再次执行。`
        );
        process.exit(1);
    }

    // 3. rebase 最新 origin/master，避免 PR 时代码冲突
    log_info("正在获取并同步 origin/master...");
    await git.fetch("origin", "master");
    try {
      await git.rebase(["origin/master"]);
    } catch (e: any) {
       log_error(`Rebase 失败，请手动解决冲突:\n${e.message}`);
       process.exit(1);
    }

    // 4. 推送到远程
    let hasRemoteBranch = false;
    try {
      runCommand(`git rev-parse --abbrev-ref ${currentBranch}@{upstream}`);
      hasRemoteBranch = true;
    } catch {
      hasRemoteBranch = false;
    }

    if (!hasRemoteBranch) {
      log_info(`推送新分支 ${currentBranch} 到远端...`);
      await git.push(["--set-upstream", "origin", currentBranch]);
    } else {
      log_info(`推送到远端...`);
      await git.push();
    }

    log_success(`成功提交并推送到分支 ${currentBranch}`);
  } catch (error: any) {
    log_error(`操作失败: ${error.message}`);
    process.exit(1);
  }
}

main();
