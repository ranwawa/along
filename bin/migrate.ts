#!/usr/bin/env bun
/**
 * migrate.ts - 将旧的平级目录结构迁移到新的 owner/repo/issueNumber 层级结构
 *
 * 旧结构:
 *   ~/.along/sessions/{N}-status.json, {N}-todo.md, {N}-issue.json, {N}-step*.md
 *   ~/.along/worktrees/{N}/
 *   ~/.along/logs/{N}-session.log, {N}-tmux.log
 *
 * 新结构:
 *   ~/.along/{owner}/{repo}/{N}/status.json, todo.md, issue.json, step*.md, worktree/, session.log, tmux.log
 */
import { $ } from "bun";
import fs from "fs";
import path from "path";
import { consola } from "consola";
import chalk from "chalk";
import { Command } from "commander";
import { config } from "./config";
import { SessionPathManager } from "./session-paths";

const logger = consola.withTag("migrate");

interface MigrationCandidate {
  issueNumber: number;
  owner: string;
  repo: string;
  files: { src: string; dest: string }[];
  worktreeSrc?: string;
  worktreeDest: string;
}

function findOldSessions(baseDir: string): MigrationCandidate[] {
  const sessionsDir = path.join(baseDir, "sessions");
  const worktreesDir = path.join(baseDir, "worktrees");
  const logsDir = path.join(baseDir, "logs");

  if (!fs.existsSync(sessionsDir)) return [];

  const statusFiles = fs.readdirSync(sessionsDir).filter(f => /^\d+-status\.json$/.test(f));
  const candidates: MigrationCandidate[] = [];

  for (const statusFile of statusFiles) {
    const issueNumber = Number(statusFile.match(/^(\d+)-/)![1]);
    const statusPath = path.join(sessionsDir, statusFile);

    let owner = "";
    let repo = "";

    try {
      const data = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
      if (data.repo?.owner && data.repo?.name) {
        owner = data.repo.owner;
        repo = data.repo.name;
      }
    } catch {}

    if (!owner || !repo) {
      logger.warn(`跳过 #${issueNumber}: status.json 中缺少 repo.owner/repo.name`);
      continue;
    }

    const paths = new SessionPathManager(owner, repo, issueNumber);
    const issueDir = paths.getIssueDir();
    const files: { src: string; dest: string }[] = [];

    // session 文件映射
    const fileMap: Record<string, string> = {
      [`${issueNumber}-status.json`]: "status.json",
      [`${issueNumber}-todo.md`]: "todo.md",
      [`${issueNumber}-issue.json`]: "issue.json",
    };

    // 查找 step 文件
    const stepFiles = fs.readdirSync(sessionsDir).filter(f => f.startsWith(`${issueNumber}-step`));
    for (const sf of stepFiles) {
      const newName = sf.replace(`${issueNumber}-`, "");
      fileMap[sf] = newName;
    }

    // PR comments / CI failures
    for (const suffix of ["pr-comments.json", "ci-failures.json"]) {
      const oldName = `${issueNumber}-${suffix}`;
      if (fs.existsSync(path.join(sessionsDir, oldName))) {
        fileMap[oldName] = suffix;
      }
    }

    for (const [oldName, newName] of Object.entries(fileMap)) {
      const src = path.join(sessionsDir, oldName);
      if (fs.existsSync(src)) {
        files.push({ src, dest: path.join(issueDir, newName) });
      }
    }

    // 日志文件
    if (fs.existsSync(logsDir)) {
      const logMap: Record<string, string> = {
        [`${issueNumber}-session.log`]: "session.log",
        [`${issueNumber}-tmux.log`]: "tmux.log",
        [`${issueNumber}-pr-review-tmux.log`]: "pr-review-tmux.log",
      };
      for (const [oldName, newName] of Object.entries(logMap)) {
        const src = path.join(logsDir, oldName);
        if (fs.existsSync(src)) {
          files.push({ src, dest: path.join(issueDir, newName) });
        }
      }
    }

    // worktree
    const worktreeSrc = path.join(worktreesDir, String(issueNumber));
    const worktreeDest = paths.getWorktreeDir();

    candidates.push({
      issueNumber,
      owner,
      repo,
      files,
      worktreeSrc: fs.existsSync(worktreeSrc) ? worktreeSrc : undefined,
      worktreeDest,
    });
  }

  return candidates;
}

async function migrateWorktree(src: string, dest: string): Promise<boolean> {
  try {
    await $`git worktree move ${src} ${dest}`.quiet();
    return true;
  } catch {
    logger.warn(`git worktree move 失败，尝试手动迁移...`);
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(src, dest);
      await $`git worktree repair`.quiet().nothrow();
      return true;
    } catch (e: any) {
      logger.error(`worktree 迁移失败: ${e.message}`);
      return false;
    }
  }
}

async function main() {
  const program = new Command();
  program
    .name("migrate")
    .description("将旧的平级目录结构迁移到 owner/repo/issueNumber 层级结构")
    .option("-n, --dry-run", "仅预览，不执行迁移", false)
    .parse();

  const { dryRun } = program.opts();
  const baseDir = config.USER_ALONG_DIR;

  const candidates = findOldSessions(baseDir);
  if (candidates.length === 0) {
    logger.info("没有需要迁移的旧格式 session");
    return;
  }

  logger.log("");
  logger.log(chalk.cyan(`发现 ${candidates.length} 个需要迁移的 session:`));
  for (const c of candidates) {
    const fileCount = c.files.length;
    const hasWorktree = c.worktreeSrc ? chalk.green("✓") : chalk.red("✗");
    logger.log(`  #${c.issueNumber}  ${c.owner}/${c.repo}  文件: ${fileCount}  worktree: ${hasWorktree}`);
  }
  logger.log("");

  if (dryRun) {
    logger.info("dry-run 模式，未执行迁移");
    return;
  }

  let migrated = 0;
  for (const candidate of candidates) {
    logger.info(`迁移 #${candidate.issueNumber} (${candidate.owner}/${candidate.repo})...`);

    // 创建目标目录
    const paths = new SessionPathManager(candidate.owner, candidate.repo, candidate.issueNumber);
    paths.ensureDir();

    // 复制文件
    for (const { src, dest } of candidate.files) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }

    // 迁移 worktree
    if (candidate.worktreeSrc) {
      const ok = await migrateWorktree(candidate.worktreeSrc, candidate.worktreeDest);
      if (!ok) {
        logger.warn(`#${candidate.issueNumber} worktree 迁移失败，文件已复制但 worktree 未迁移`);
      }
    }

    // 删除旧文件
    for (const { src } of candidate.files) {
      fs.unlinkSync(src);
    }

    migrated++;
    logger.success(`#${candidate.issueNumber} 迁移完成`);
  }

  // 清理空目录
  for (const dir of ["sessions", "worktrees", "logs", "artifacts", "tmp"]) {
    const dirPath = path.join(baseDir, dir);
    if (fs.existsSync(dirPath)) {
      try {
        const remaining = fs.readdirSync(dirPath);
        if (remaining.length === 0) {
          fs.rmdirSync(dirPath);
          logger.info(`已删除空目录: ${dir}/`);
        } else {
          logger.info(`目录 ${dir}/ 仍有 ${remaining.length} 个文件，保留`);
        }
      } catch {}
    }
  }

  await $`git worktree prune`.quiet().nothrow();

  logger.success(`迁移完成，共迁移 ${migrated} 个 session`);
}

main();
