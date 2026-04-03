import fs from "fs";
import path from "path";
import { config } from "./config";
import { consola } from "consola";
import { iso_timestamp, getSessionId } from "./common";

const logger = consola.withTag("todo-helper");

const STEP_LABELS: Record<number, string> = {
  1: "第一步",
  2: "第二步",
  3: "第三步",
  4: "第四步",
  5: "第五步",
};

/**
 * 保存步骤产出到独立文件
 * 文件命名: {sessionId}-step{N}-{scriptName}.md 或 {issueNumber}-step{N}-{scriptName}.md
 * @returns 产出文件的文件名（不含目录）
 */
export function saveStepOutput(
  issueNumberOrOwner: string, 
  stepNumber: number, 
  scriptNameOrRepo: string, 
  contentOrIssueNumber: string | number,
  maybeScriptName?: string,
  maybeContent?: string
): string {
  let sessionId: string;
  let actualStepNumber: number;
  let actualScriptName: string;
  let actualContent: string;
  
  // 判断调用方式：新格式 (owner, repo, issueNumber, stepNumber, scriptName, content) 还是旧格式 (issueNumber, stepNumber, scriptName, content)
  if (typeof contentOrIssueNumber === 'number' && maybeScriptName && maybeContent) {
    // 新格式
    const owner = issueNumberOrOwner;
    const repo = scriptNameOrRepo;
    const issueNumber = contentOrIssueNumber;
    sessionId = getSessionId(owner, repo, issueNumber);
    actualStepNumber = stepNumber;
    actualScriptName = maybeScriptName;
    actualContent = maybeContent;
  } else {
    // 旧格式（向后兼容）
    sessionId = issueNumberOrOwner;
    actualStepNumber = stepNumber;
    actualScriptName = scriptNameOrRepo;
    actualContent = contentOrIssueNumber as string;
  }
  
  const fileName = `${sessionId}-step${actualStepNumber}-${actualScriptName}.md`;
  const filePath = path.join(config.SESSION_DIR, fileName);
  fs.writeFileSync(filePath, actualContent, "utf-8");
  return fileName;
}

/**
 * 勾选 todo.md 中对应步骤，并在下方附上时间戳和产出文件引用
 *
 * 将 `- [ ] 第N步：xxx` 替换为:
 * ```
 * - [x] 第N步：xxx
 *   > ✅ 2026-04-01T12:00:00Z | summary
 *   > 📄 详情: {sessionId}-step{N}-{scriptName}.md
 * ```
 */
export function completeTodoStep(
  issueNumberOrOwner: string, 
  stepNumber: number, 
  summaryOrRepo: string, 
  outputFileNameOrIssueNumber?: string | number,
  maybeOutputFileName?: string
): void {
  let sessionId: string;
  let actualStepNumber: number;
  let actualSummary: string;
  let actualOutputFileName: string | undefined;
  
  // 判断调用方式：新格式 (owner, repo, issueNumber, stepNumber, summary, outputFileName?) 还是旧格式 (issueNumber, stepNumber, summary, outputFileName?)
  if (typeof outputFileNameOrIssueNumber === 'number') {
    // 新格式
    const owner = issueNumberOrOwner;
    const repo = summaryOrRepo;
    const issueNumber = outputFileNameOrIssueNumber;
    sessionId = getSessionId(owner, repo, issueNumber);
    actualStepNumber = stepNumber;
    actualSummary = maybeOutputFileName !== undefined ? arguments[4] as string : '';
    actualOutputFileName = arguments.length > 5 ? arguments[5] as string : undefined;
  } else {
    // 旧格式（向后兼容）
    sessionId = issueNumberOrOwner;
    actualStepNumber = stepNumber;
    actualSummary = summaryOrRepo;
    actualOutputFileName = outputFileNameOrIssueNumber as string | undefined;
  }
  
  const todoFile = path.join(config.SESSION_DIR, `${sessionId}-todo.md`);
  if (!fs.existsSync(todoFile)) {
    logger.warn(`todo 文件不存在: ${todoFile}`);
    return;
  }

  const label = STEP_LABELS[stepNumber];
  if (!label) {
    logger.warn(`未知步骤编号: ${stepNumber}`);
    return;
  }

  let content = fs.readFileSync(todoFile, "utf-8");
  const timestamp = iso_timestamp();

  // 匹配 `- [ ] 第N步：xxx` 或 `- [ ] 第N步:xxx`
  const pattern = new RegExp(`^(- \\[ \\] ${label}[：:].*)$`, "m");
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
  fs.writeFileSync(todoFile, content, "utf-8");
  logger.success(`todo 已自动更新: ${label}`);
}
