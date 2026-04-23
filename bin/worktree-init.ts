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
  getGit,
} from "./common";

const logger = consola.withTag("worktree-init");
import type { Result } from "./common";
import { config } from "./config";
import type { EditorConfig } from "./config";
import type { SessionPathManager } from "./session-paths";
import type { SessionManager } from "./session-manager";
import { upsertSession } from "./db";

export async function getDefaultBranch(repoPath?: string): Promise<Result<string>> {
  try {
    const g = repoPath ? getGit(repoPath) : git;
    const remoteInfo = await g.raw(["remote", "show", "origin"]);
    const match = remoteInfo.match(/HEAD branch: (.+)/);
    if (match && match[1]) {
      return success(match[1].trim());
    }
  } catch {
    // 如果获取失败，回退到 master
  }
  return success("master");
}

export async function setupWorktree(worktreePath: string, repoPath?: string, session?: SessionManager): Promise<Result<null>> {
  if (fs.existsSync(worktreePath)) {
    if (fs.existsSync(path.join(worktreePath, ".along/issue-mark"))) return success(null);
    // planning 阶段创建的软链需要先清理再创建真正的 worktree
    try {
      const stat = fs.lstatSync(worktreePath);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(worktreePath);
        logger.info("已清理 planning 阶段的软链工作目录");
      } else {
        return failure(`工作目录存在但非本工具创建，请手动检查: ${worktreePath}`);
      }
    } catch {
      return failure(`工作目录存在但非本工具创建，请手动检查: ${worktreePath}`);
    }
  }

  const defaultBranchRes = await getDefaultBranch(repoPath);
  if (!defaultBranchRes.success) return defaultBranchRes;
  const defaultBranch = defaultBranchRes.data;

  logger.info(`检测到远程默认分支: ${defaultBranch}`);

  const g = repoPath ? getGit(repoPath) : git;

  logger.info("获取远程最新代码...");
  try {
    await g.fetch("origin", defaultBranch);
  } catch (e: any) {
    session?.log(`fetch 远程分支失败: ${e.message}\n${e.stack || ""}`, "error");
    return failure(`fetch 远程分支失败: ${e.message}`);
  }
  console.log(chalk.green("✓"), "获取远程最新代码完成");

  logger.info("创建 worktree...");
  try {
    try {
      await g.raw(["worktree", "prune"]);
    } catch (e) {}

    await g.raw(["worktree", "add", "-f", "--detach", worktreePath, `origin/${defaultBranch}`]);
  } catch (e: any) {
    session?.log(`创建 worktree 失败: ${e.message}\n${e.stack || ""}`, "error");
    return failure(`创建 worktree 失败: ${e.message}`);
  }
  console.log(chalk.green("✓"), "创建 worktree 完成");
  session?.logEvent("worktree-created", { worktreePath, defaultBranch });

  return success(null);
}

export function setupPlanningWorkspace(worktreePath: string, repoRoot: string, session?: SessionManager): Result<null> {
  if (fs.existsSync(worktreePath)) {
    try {
      const stat = fs.lstatSync(worktreePath);
      if (stat.isSymbolicLink()) return success(null);
      if (fs.existsSync(path.join(worktreePath, ".along/issue-mark"))) return success(null);
    } catch {}
    return failure(`工作目录已存在，请手动检查: ${worktreePath}`);
  }

  try {
    fs.symlinkSync(repoRoot, worktreePath, "dir");
  } catch (e: any) {
    return failure(`创建 planning 工作目录软链失败: ${e.message}`);
  }
  logger.info("已创建 planning 工作目录（软链到主仓库）");
  session?.logEvent("planning-workspace-created", { worktreePath, repoRoot });
  return success(null);
}

function removeTargetPath(targetPath: string): Result<void> {
  let stat: fs.Stats | null = null;
  try {
    stat = fs.lstatSync(targetPath);
  } catch {
    return success(undefined);
  }

  try {
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(targetPath);
    } else {
      fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 3 });
    }
    return success(undefined);
  } catch (rmError: any) {
    logger.warn(`删除目标失败，尝试强制移除: ${rmError.message}`);
    const backupPath = `${targetPath}.backup-${Date.now()}`;
    try {
      fs.renameSync(targetPath, backupPath);
      fs.rmSync(backupPath, { recursive: true, force: true });
      return success(undefined);
    } catch (renameError: any) {
      return failure(`无法清理目标路径 ${targetPath}: ${renameError.message}`);
    }
  }
}

function ensureMappingSymlink(sourceDir: string, targetPath: string): Result<void> {
  if (!fs.existsSync(sourceDir)) {
    return failure(`源目录不存在: ${sourceDir}`);
  }

  const removeRes = removeTargetPath(targetPath);
  if (!removeRes.success) return removeRes;

  const targetParentDir = path.dirname(targetPath);
  if (!fs.existsSync(targetParentDir)) {
    fs.mkdirSync(targetParentDir, { recursive: true });
  }

  const relativeSource = path.relative(targetParentDir, sourceDir);
  fs.symlinkSync(relativeSource, targetPath, "dir");
  return success(undefined);
}

export function syncEditorMappings(worktreePath: string, editor: EditorConfig): Result<void> {
  for (const mapping of editor.mappings) {
    const sourceDir = path.join(config.ROOT_DIR, mapping.from);
    const targetPath = path.join(worktreePath, mapping.to);

    const linkRes = ensureMappingSymlink(sourceDir, targetPath);
    if (!linkRes.success) {
      logger.error(`  同步失败 (${mapping.to}): ${linkRes.error}`);
      return failure(`同步编辑器环境 ${mapping.to} 失败: ${linkRes.error}`);
    }

    logger.info(`  已软链: ${chalk.cyan(mapping.to)}`);
  }

  return success(undefined);
}

export function initPlanningSession(paths: SessionPathManager, statusData: any, session?: SessionManager): Result<void> {
  try {
    logger.info("创建 planning 会话状态...");
    const ensureRes = paths.ensureDir();
    if (!ensureRes.success) return ensureRes;

    const upRes = upsertSession(
      paths.getOwner(),
      paths.getRepo(),
      paths.getIssueNumber(),
      statusData,
    );
    if (!upRes.success) return upRes;
    console.log(chalk.green("✓"), "创建 planning 会话状态完成");

    logger.info("创建初始 todo 文件...");
    const todoContent = `- [ ] 第一步：理解 Issue 并创建语义化分支\n- [ ] 第二步：分析代码库并制定实施计划\n- [ ] 第三步：实施修复\n- [ ] 第四步：提交并推送代码\n- [ ] 第五步：创建 PR 并更新状态\n`;
    if (!fs.existsSync(paths.getTodoFile())) {
      fs.writeFileSync(paths.getTodoFile(), todoContent);
    }
    console.log(chalk.green("✓"), "创建初始 todo 文件完成");

    session?.logEvent("planning-session-initialized", {
      issueNumber: String(paths.getIssueNumber()),
    });
    return success(undefined);
  } catch (e: any) {
    logger.error(`初始化 planning 会话失败: ${e.message}`);
    return failure(`初始化 planning 会话失败: ${e.message}`);
  }
}

export async function initSessionFiles(paths: SessionPathManager, worktreePath: string, statusData: any, session?: SessionManager): Promise<Result<void>> {
  try {
  const issueNumber = String(paths.getIssueNumber());

  // 1. 创建 .along 并标记
  logger.info("创建 worktree 标记...");
  fs.mkdirSync(path.join(worktreePath, ".along"), { recursive: true });
  fs.writeFileSync(path.join(worktreePath, ".along/issue-mark"), issueNumber);
  console.log(chalk.green("✓"), "创建 worktree 标记完成");

  // 2. 自动环境同步（按编辑器映射软链 skills 和 prompts）
  logger.info("同步编辑器环境...");
  const tagRes = config.getLogTag();
  if (!tagRes.success) return tagRes;
  const currentTag = tagRes.data;

  const currentEditor = config.EDITORS.find(e => e.id === currentTag) || config.EDITORS[0];
  logger.info(`检测到编辑器环境: ${currentEditor.name}`);
  const syncRes = syncEditorMappings(worktreePath, currentEditor);
  if (!syncRes.success) return syncRes;
  console.log(chalk.green("✓"), "同步编辑器环境完成");

  logger.info("创建会话状态...");
  const ensureRes = paths.ensureDir();
  if (!ensureRes.success) return ensureRes;

  const upRes = upsertSession(
    paths.getOwner(),
    paths.getRepo(),
    paths.getIssueNumber(),
    statusData,
  );
  if (!upRes.success) return upRes;
  console.log(chalk.green("✓"), "创建会话状态完成");

  logger.info("创建初始 todo 文件...");
  const todoContent = `- [ ] 第一步：理解 Issue 并创建语义化分支\n- [ ] 第二步：分析代码库并制定实施计划\n- [ ] 第三步：实施修复\n- [ ] 第四步：提交并推送代码\n- [ ] 第五步：创建 PR 并更新状态\n`;
  fs.writeFileSync(paths.getTodoFile(), todoContent);
  console.log(chalk.green("✓"), "创建初始 todo 文件完成");

  session?.logEvent("session-initialized", {
    issueNumber,
    worktreePath,
    editor: currentEditor.name,
    mappingCount: currentEditor.mappings.length,
  });
  return success(undefined);
  } catch (e: any) {
    logger.error(`初始化会话文件失败: ${e.message}`);
    return failure(`初始化会话文件失败: ${e.message}`);
  }
}

/**
 * 移除指定路径的 worktree
 */
export async function removeWorktree(worktreePath: string, repoPath?: string): Promise<Result<void>> {
  if (!fs.existsSync(worktreePath)) {
    return success(undefined);
  }

  try {
    const g = repoPath ? getGit(repoPath) : git;
    await g.raw(["worktree", "remove", "--force", worktreePath]);
    logger.info(`已成功移除 worktree: ${worktreePath}`);
    return success(undefined);
  } catch (e: any) {
    logger.error(`移除 worktree 失败: ${e.message}`);
    return failure(`移除 worktree 失败: ${e.message}`);
  }
}
