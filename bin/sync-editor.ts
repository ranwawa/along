#!/usr/bin/env bun
/**
 * .along/bin/sync-editor.ts
 * 将 .along 中的公共资源复制到指定编辑器的目录中（当前目录 + 所有 worktree）
 */

import fs from "fs";
import path from "path";
import { config } from "./config";
import { consola } from "consola";

const logger = consola.withTag("sync-editor");

/**
 * 递归复制目录（与 worktree-init.ts 保持一致）
 */
function copyDirectory(src: string, dest: string) {
  if (!fs.existsSync(src)) return;

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

/**
 * 处理单个资源映射的复制
 */
function syncMapping(mapping: any, projectRoot: string) {
  const sourceDir = path.join(config.ROOT_DIR, mapping.from);
  const targetPath = path.join(projectRoot, mapping.to);

  if (!fs.existsSync(sourceDir)) {
    logger.warn(`源目录不存在，跳过: ${mapping.from}`);
    return;
  }

  try {
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }

    const targetParentDir = path.dirname(targetPath);
    if (!fs.existsSync(targetParentDir)) {
      fs.mkdirSync(targetParentDir, { recursive: true });
    }

    copyDirectory(sourceDir, targetPath);
    logger.success(`已同步: ${mapping.to}`);
  } catch (e: any) {
    logger.error(`同步失败 ${mapping.to}: ${e.message}`);
  }
}

/**
 * 获取选定的编辑器配置
 */
async function getSelectedEditor(editors: any[]) {
  const editorId = (await logger.prompt("请选择要同步的编辑器:", {
    type: "select",
    options: editors.map((e) => ({ label: e.name, value: e.id })),
  })) as string;

  const selectedEditor = editors.find((e: any) => e.id === editorId);
  if (!selectedEditor) {
    logger.error("无效的选择");
    process.exit(1);
  }
  return selectedEditor;
}

/**
 * 获取 ~/.along/worktrees/ 下所有工作空间目录
 */
function getWorktreeDirs(): string[] {
  const worktreeRoot = config.WORKTREE_DIR;
  if (!fs.existsSync(worktreeRoot)) return [];

  return fs
    .readdirSync(worktreeRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(worktreeRoot, d.name));
}

async function main() {
  const editors = config.EDITORS;
  if (!editors || editors.length === 0) {
    logger.error("未找到编辑器配置");
    process.exit(1);
  }

  const selectedEditor = await getSelectedEditor(editors);
  logger.info(`正在为 ${selectedEditor.name} 同步资源...`);

  // 同步到当前目录
  const projectRoot = process.cwd();
  for (const mapping of selectedEditor.mappings) {
    syncMapping(mapping, projectRoot);
  }

  // 同步到所有已存在的 worktree
  const worktrees = getWorktreeDirs();
  if (worktrees.length > 0) {
    logger.info(`发现 ${worktrees.length} 个工作空间，正在同步...`);
    for (const worktree of worktrees) {
      for (const mapping of selectedEditor.mappings) {
        syncMapping(mapping, worktree);
      }
    }
  }

  logger.success("同步完成！");
}

main().catch((err) => {
  logger.error("同步过程中发生错误:", err);
  process.exit(1);
});
