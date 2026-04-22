#!/usr/bin/env bun
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { Command } from "commander";
import { $ } from "bun";
import { consola } from "consola";
import { git, iso_timestamp } from "./common";
import { getDefaultBranch } from "./worktree-init";

const logger = consola.withTag("commit-push");
import { runCommand } from "./exec";
import chalk from "chalk";
import { saveStepOutput, completeTodoStep } from "./todo-helper";
import { SessionPathManager } from "./session-paths";
import { readRepoInfo } from "./github-client";
import { SessionManager } from "./session-manager";
import { findSessionByBranch } from "./db";

/**
 * .along/bin/commit-push.ts
 * 进行原子化提交并推送到远端
 */

interface Commit {
  message: string;
  files: string[];
}

async function updateStatusAfterPush(branchName: string): Promise<{ issueNumber: string; owner: string; repo: string } | null> {
  // 通过 branchName 在数据库中找到对应的 session
  const foundRes = findSessionByBranch(branchName);
  if (!foundRes.success || !foundRes.data) return null;
  const found = foundRes.data;

  const session = new SessionManager(found.owner, found.repo, found.issueNumber);
  const res = await session.transition({ type: "COMMITS_PUSHED" });
  if (res.success) {
    logger.success("状态已自动更新");
  }

  return { issueNumber: String(found.issueNumber), owner: found.owner, repo: found.repo };
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
      logger.error("解析 --json 失败，请检查格式");
      process.exit(1);
    }
  } else if (opts.message && opts.files) {
    commits = [{ message: opts.message, files: opts.files }];
  } else {
    logger.error("必须提供 --message 和 --files，或者提供 --json");
    program.help();
    process.exit(1);
  }

  try {
    const currentBranchRes = runCommand("git branch --show-current");
    if (!currentBranchRes.success) {
      logger.error(`无法获取当前分支: ${currentBranchRes.error}`);
      process.exit(1);
    }
    const currentBranch = currentBranchRes.data.trim();

    const statusRes = runCommand("git status --porcelain");
    if (!statusRes.success) {
      logger.error(`无法获取 git 状态: ${statusRes.error}`);
      process.exit(1);
    }
    const status = statusRes.data;
    const commitShas: string[] = [];

    // 清理当前暂存区
    runCommand("git reset");

    if (!status && commits.length > 0) {
       // 检查是否已经提交了 (如果有 commits 但 status 为空，可能是已经 commit 过了，但没 push)
       // 但通常我们会根据 status 来判断是否有新变更
    }

    if (!status) {
       logger.info("未检测到任何待提交的变更");
    } else {
      // ── 质量门禁：提交前自动运行目标项目的 typecheck 和 test ──
      const pkgPath = path.join(process.cwd(), "package.json");
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          const scripts = pkg.scripts || {};

          // TypeScript 类型检查
          const tscScriptName = scripts["typecheck"] ? "typecheck" : scripts["type-check"] ? "type-check" : scripts["tsc"] ? "tsc" : null;
          if (tscScriptName) {
            logger.info(`运行类型检查 (npm run ${tscScriptName})...`);
            const tscRes = runCommand(`npm run ${tscScriptName}`);
            if (!tscRes.success) {
              logger.error(`类型检查未通过，请修复后重试:\n${tscRes.error}`);
              process.exit(1);
            }
            logger.success("类型检查通过");
          } else if (fs.existsSync(path.join(process.cwd(), "tsconfig.json"))) {
            logger.info("检测到 tsconfig.json，运行 tsc --noEmit...");
            const tscRes = runCommand("npx tsc --noEmit");
            if (!tscRes.success) {
              logger.error(`类型检查未通过，请修复后重试:\n${tscRes.error}`);
              process.exit(1);
            }
            logger.success("类型检查通过");
          }

          // 测试
          const testScript = scripts["test"];
          if (testScript && !testScript.includes("no test specified")) {
            logger.info("运行测试...");
            const testRes = runCommand("npm test");
            if (!testRes.success) {
              logger.error(`测试未通过，请修复后重试:\n${testRes.error}`);
              process.exit(1);
            }
            logger.success("测试通过");
          }
        } catch (e: any) {
          logger.warn(`质量门禁检查出错（不阻断提交）: ${e.message}`);
        }
      }
      // ── 质量门禁结束 ──

      for (const commit of commits) {
        if (!commit.files || commit.files.length === 0) continue;

        for (const file of commit.files) {
           await git.add(file);
        }

        const tempMsgFile = path.join(os.tmpdir(), `along-commit-msg-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.txt`);
        fs.writeFileSync(tempMsgFile, commit.message, "utf-8");
        try {
          const commitResult = await git.raw(["commit", "-F", tempMsgFile]);
          // 获取刚创建的 commit SHA
          const sha = (await git.raw(["rev-parse", "HEAD"])).trim();
          commitShas.push(sha);
          logger.info(`Commit SHA: ${sha}`);
        } finally {
          if (fs.existsSync(tempMsgFile)) {
            fs.unlinkSync(tempMsgFile);
          }
        }
      }
    }

    // 2. 检查是否还有未提交的变更
    const remainingStatus = runCommand("git status --porcelain");
    if (remainingStatus.success && remainingStatus.data?.trim()) {
        logger.error(
            `检测到尚有未提交的变更 (Uncommitted changes detected):\n${remainingStatus.data}\n\n` +
            `[🚨 警告] 如果这些是你在处理任务时生成的临时脚本、测试文件或备注日志（如 .sh, .py, .txt 等），请使用 rm 命令将它们删除！绝对不要将它们提交到代码库中。\n` +
            `如果这些是业务需要的常规代码变更，请将其加入提交列表后再次执行。`
        );
        process.exit(1);
    }

    // 3. rebase 最新默认分支，避免 PR 时代码冲突
    const defaultBranchRes = await getDefaultBranch();
    if (!defaultBranchRes.success) {
      logger.error(`无法获取默认分支: ${defaultBranchRes.error}`);
      process.exit(1);
    }
    const defaultBranch = defaultBranchRes.data;
    logger.info(`正在获取并同步 origin/${defaultBranch}...`);
    await git.fetch("origin", defaultBranch);
    try {
      await git.rebase([`origin/${defaultBranch}`]);
    } catch (e: any) {
       logger.error(`Rebase 失败，请手动解决冲突:\n${e.message}`);
       process.exit(1);
    }

    // 4. 推送到远程
    let hasRemoteBranch = false;
    try {
      const checkRes = runCommand(`git rev-parse --abbrev-ref ${currentBranch}@{upstream}`);
      hasRemoteBranch = checkRes.success;
    } catch {
      hasRemoteBranch = false;
    }

    if (!hasRemoteBranch) {
      logger.info(`推送新分支 ${currentBranch} 到远端...`);
      await git.push(["--set-upstream", "origin", currentBranch]);
    } else {
      logger.info(`推送到远端...`);
      await git.push();
    }

    logger.success(`成功提交并推送到分支 ${currentBranch}`);

    // 自动更新数据库 + todo + session.log
    const sessionInfo = await updateStatusAfterPush(currentBranch);
    if (sessionInfo) {
      const { owner, repo } = sessionInfo;
      const paths = new SessionPathManager(owner, repo, Number(sessionInfo.issueNumber));
      const session = new SessionManager(owner, repo, Number(sessionInfo.issueNumber));

      // 记录 commit SHAs 到 session
      for (const sha of commitShas) {
        session.addCommitSha(sha);
      }
      session.logEvent("commits-pushed", {
        branch: currentBranch,
        commitCount: commits.length,
        commitShas,
      });

      const commitSummary = commits.map(c => `- ${c.message} (${c.files.join(", ")})`).join("\n");
      const outputContent = [
        `# 第四步：提交并推送代码`,
        ``,
        `- **分支**: ${currentBranch}`,
        `- **提交数**: ${commits.length}`,
        `- **Commit SHAs**: ${commitShas.join(", ")}`,
        ``,
        `## Commits`,
        ``,
        commitSummary,
      ].join("\n");
      const outputFile = saveStepOutput(paths, 4, "commit-push", outputContent);
      completeTodoStep(paths, 4, `已提交并推送 ${commits.length} 个 commit`, outputFile);
    }
  } catch (error: any) {
    // 尝试写入 session.log
    try {
      const currentBranchRes = runCommand("git branch --show-current");
      if (currentBranchRes.success) {
        const foundRes = findSessionByBranch(currentBranchRes.data.trim());
        if (foundRes.success && foundRes.data) {
          const session = new SessionManager(foundRes.data.owner, foundRes.data.repo, foundRes.data.issueNumber);
          session.log(`commit-push 失败: ${error.message}\n${error.stack || ""}`, "error");
        }
      }
    } catch {}
    logger.error(`操作失败: ${error.message}`);
    process.exit(1);
  }
}

main();
