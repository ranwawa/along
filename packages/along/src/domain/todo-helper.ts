import fs from 'node:fs';
import path from 'node:path';
import { consola } from 'consola';
import { iso_timestamp } from '../core/common';
import type { SessionPathManager } from '../core/session-paths';

const logger = consola.withTag('todo-helper');

const STEP_LABELS: Record<number, string> = {
  1: '第一步',
  2: '第二步',
  3: '第三步',
  4: '第四步',
  5: '第五步',
};

/**
 * 保存步骤产出到独立文件
 * @returns 产出文件的文件名（不含目录）
 */
export function saveStepOutput(
  paths: SessionPathManager,
  stepNumber: number,
  scriptName: string,
  content: string,
): string {
  const ensureRes = paths.ensureDir();
  if (!ensureRes.success) {
    logger.error(`无法确保目录存在: ${ensureRes.error}`);
  }
  const filePath = paths.getStepOutputFile(stepNumber, scriptName);
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
  } catch (e: any) {
    logger.error(`无法写入产出文件: ${e.message}`);
  }
  return path.basename(filePath);
}

/**
 * 勾选 todo.md 中对应步骤，并在下方附上时间戳和产出文件引用
 *
 * 将 `- [ ] 第N步：xxx` 替换为:
 * ```
 * - [x] 第N步：xxx
 *   > ✅ 2026-04-01T12:00:00Z | summary
 *   > 📄 详情: step{N}-{scriptName}.md
 * ```
 */
export function completeTodoStep(
  paths: SessionPathManager,
  stepNumber: number,
  summary: string,
  outputFileName?: string,
): void {
  const todoFile = paths.getTodoFile();
  if (!fs.existsSync(todoFile)) {
    logger.warn(`todo 文件不存在: ${todoFile}`);
    return;
  }

  const label = STEP_LABELS[stepNumber];
  if (!label) {
    logger.warn(`未知步骤编号: ${stepNumber}`);
    return;
  }

  let content = fs.readFileSync(todoFile, 'utf-8');
  const timestamp = iso_timestamp();

  // 匹配 `- [ ] 第N步：xxx` 或 `- [ ] 第N步:xxx`
  const pattern = new RegExp(`^(- \\[ \\] ${label}[：:].*)$`, 'm');
  const match = content.match(pattern);
  if (!match) {
    logger.warn(`未找到待勾选的步骤: ${label}`);
    return;
  }

  let replacement = `- [x] ${match[1].slice(6)}\n  > ✅ ${timestamp} | ${summary}`;
  if (outputFileName) {
    replacement += `\n  > 📄 详情: ${outputFileName}`;
  }

  content = content.replace(pattern, replacement);
  fs.writeFileSync(todoFile, content, 'utf-8');
  logger.success(`todo 已自动更新: ${label}`);
}
