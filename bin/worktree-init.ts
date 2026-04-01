/**
 * worktree-init.ts - Worktree 初始化核心逻辑
 * 供 run.ts 直接调用
 */
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { consola } from "consola";
import {
  success,
  failure,
  git,
} from "./common";

const logger = consola.withTag("worktree-init");
import type { Result } from "./common";
import { config } from "./config";

export async function getDefaultBranch(): Promise<string> {
  try {
    const remoteInfo = await git.raw(["remote", "show", "origin"]);
    const match = remoteInfo.match(/HEAD branch: (.+)/);
    if (match && match[1]) {
      return match[1].trim();
    }
  } catch (e) {
    // 如果获取失败，回退到master
  }
  return "master";
}

export function getBranchName(issueNumber: string, issueTitle: string, suffix: string) {
  const titleSlug = issueTitle
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 30);
  return `feat/${issueNumber}-${titleSlug || "task"}-${suffix}`;
}

export async function setupWorktree(worktreePath: string, branchName: string): Promise<Result<null>> {
  if (fs.existsSync(worktreePath)) {
    if (fs.existsSync(path.join(worktreePath, ".along/issue-mark"))) return success(null);
    return failure(`工作目录存在但非本工具创建，请手动检查: ${worktreePath}`);
  }

  const defaultBranch = await getDefaultBranch();
  logger.info(`检测到远程默认分支: ${defaultBranch}`);

  logger.info("获取远程最新代码...");
  try {
    await git.fetch("origin", defaultBranch);
  } catch (e: any) {
    return failure(`fetch 远程分支失败: ${e.message}`);
  }
  console.log(chalk.green("✓"), "获取远程最新代码完成");

  logger.info("创建 worktree...");
  try {
    await git.raw(["worktree", "add", worktreePath, "-B", branchName, `origin/${defaultBranch}`]);
  } catch (e: any) {
    return failure(`创建 worktree 失败: ${e.message}`);
  }
  console.log(chalk.green("✓"), "创建 worktree 完成");

  return success(null);
}

function copyDirectory(src: string, dest: string) {
  if (!fs.existsSync(src)) {
    return;
  }

  const lstat = fs.lstatSync(dest, { throwIfNoEntry: false });
  if (lstat && (lstat.isSymbolicLink() || !lstat.isDirectory())) {
    fs.rmSync(dest, { force: true });
  }
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export async function initSessionFiles(worktreePath: string, issueNumber: string, statusFile: string, statusData: any, todoFile: string) {
  // 1. 创建 .along 并标记
  logger.info("创建 worktree 标记...");
  fs.mkdirSync(path.join(worktreePath, ".along"), { recursive: true });
  fs.writeFileSync(path.join(worktreePath, ".along/issue-mark"), issueNumber);
  console.log(chalk.green("✓"), "创建 worktree 标记完成");

  // 2. 自动环境同步（从 along 源目录复制 skills 和 prompts）
  logger.info("同步编辑器环境...");
  const currentTag = config.getLogTag();
  const currentEditor = config.EDITORS.find(e => e.id === currentTag) || config.EDITORS[0];
  logger.info(`检测到编辑器环境: ${currentEditor.name}`);

  for (const mapping of currentEditor.mappings) {
    const sourceDir = path.join(config.ROOT_DIR, mapping.from);
    const targetPath = path.join(worktreePath, mapping.to);

    if (!fs.existsSync(sourceDir)) {
      throw new Error(`源目录不存在: ${sourceDir}`);
    }

    try {
      if (fs.existsSync(targetPath)) {
        try {
          fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 3 });
        } catch (rmError: any) {
          logger.warn(`删除目标失败，尝试强制移除: ${rmError.message}`);
          const backupPath = `${targetPath}.backup-${Date.now()}`;
          try {
            fs.renameSync(targetPath, backupPath);
            fs.rmSync(backupPath, { recursive: true, force: true });
          } catch (renameError: any) {
            throw new Error(`无法清理目标路径 ${targetPath}: ${renameError.message}`);
          }
        }
      }

      const targetParentDir = path.dirname(targetPath);
      if (!fs.existsSync(targetParentDir)) {
        fs.mkdirSync(targetParentDir, { recursive: true });
      }

      copyDirectory(sourceDir, targetPath);
      logger.info(`  已同步: ${chalk.cyan(mapping.to)}`);
    } catch (e: any) {
      logger.error(`  同步失败 (${mapping.to}): ${e.message}`);
      throw e;
    }
  }
  console.log(chalk.green("✓"), "同步编辑器环境完成");

  logger.info("创建状态文件...");
  fs.mkdirSync(path.dirname(statusFile), { recursive: true });
  fs.writeFileSync(statusFile, JSON.stringify(statusData, null, 2));
  console.log(chalk.green("✓"), "创建状态文件完成");

  logger.info("创建初始 todo 文件...");
  const todoContent = `- [ ] 第一步：理解 Issue 并创建语义化分支\n- [ ] 第二步：分析代码库并制定实施计划\n- [ ] 第三步：实施修复\n- [ ] 第四步：提交并推送代码\n- [ ] 第五步：创建 PR 并更新状态\n`;
  fs.writeFileSync(todoFile, todoContent);
  console.log(chalk.green("✓"), "创建初始 todo 文件完成");
}
