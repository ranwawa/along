#!/usr/bin/env bun
/**
 * .along/bin/sync-editor.ts
 * 将 .along 中的公共资源同步到指定编辑器的目录中（使用软链）
 */

import fs from "fs";
import path from "path";
import { config } from "./config";
import { consola } from "consola";

const logger = consola.withTag("sync-editor");

/**
 * 处理单个资源映射的软链创建
 */
function syncMapping(mapping: any, selectedEditor: any, projectRoot: string) {
  const sourceDir = path.join(config.ROOT_DIR, mapping.from);
  const targetPath = path.join(projectRoot, mapping.to);
  const targetDir = path.dirname(targetPath);
  const relativeSource = path.relative(targetDir, sourceDir);

  if (!fs.existsSync(sourceDir)) {
    logger.warn(`源目录不存在，跳过: ${mapping.from}`);
    return;
  }

  // 确保目标父目录存在
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 处理已存在的目标
  if (fs.existsSync(targetPath)) {
    const lstat = fs.lstatSync(targetPath);
    // 如果是软链且指向正确，直接静默退出
    if (lstat.isSymbolicLink()) {
      const existingTarget = fs.readlinkSync(targetPath);
      if (existingTarget === relativeSource || existingTarget === sourceDir) {
        return; 
      }
    }
    
    // 否则，直接覆盖（删除旧的实体目录、文件或错误的软链）
    logger.info(`目标指向不符或被占用，正在更新覆盖: ${mapping.to}`);
    if (lstat.isDirectory() && !lstat.isSymbolicLink()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(targetPath);
    }
  }

  try {
    fs.symlinkSync(relativeSource, targetPath, "dir");
    logger.success(`已同步软链: ${mapping.to} -> ${relativeSource}`);
  } catch (e: any) {
    logger.error(`创建软链失败 ${mapping.to}: ${e.message}`);
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

async function main() {
  const editors = config.EDITORS;
  if (!editors || editors.length === 0) {
    logger.error("未找到编辑器配置");
    process.exit(1);
  }

  const selectedEditor = await getSelectedEditor(editors);
  logger.info(`正在为 ${selectedEditor.name} 同步资源...`);

  const projectRoot = process.cwd();
  for (const mapping of selectedEditor.mappings) {
    syncMapping(mapping, selectedEditor, projectRoot);
  }

  logger.success("同步完成！");
}

main().catch((err) => {
  logger.error("同步过程中发生错误:", err);
  process.exit(1);
});
