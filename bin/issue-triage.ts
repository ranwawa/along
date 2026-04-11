/**
 * issue-triage.ts - Issue 分类模块（内部模块，不作为 CLI 子命令）
 *
 * 在 webhook 收到 issues.opened 事件后，使用 AI 对 Issue 进行分类：
 * - bug: 缺陷/回归/异常行为，需要代码修复
 * - feature: 新功能/增强/重构/文档改进，需要代码修改
 * - question: 提问/求助/咨询，不需要代码修改
 * - spam: 广告/无意义/测试内容
 */

import { ChatOpenAI } from "@langchain/openai";
import { consola } from "consola";
import fs from "fs";
import os from "os";
import path from "path";
import { z } from "zod";
import { GitHubClient, readGithubToken } from "./github-client";
import { launchIssueAgent } from "./issue-agent";
import { Result, success, failure } from "./common";

const logger = consola.withTag("issue-triage");

export type TriageClassification = "bug" | "feature" | "question" | "spam";

export type TriageResult = {
  classification: TriageClassification;
  reason: string;
  replyMessage?: string;
};

const TRIAGE_SYSTEM_PROMPT = `你是一个 GitHub Issue 分类助手。你的任务是判断一个 Issue 的类型。

请分析以下 Issue 的标题、正文和标签，并将其分类为以下四类之一：

1. **bug**：缺陷、回归、异常行为，需要代码修复
2. **feature**：新功能、增强、重构、文档改进，需要代码修改
3. **question**：提问、求助、咨询，不需要代码修改
4. **spam**：广告、无意义内容、测试 Issue、打招呼、垃圾信息

注意：
- 如果无法确定是 bug 还是 feature，请分类为 bug（宁可多做，不可错过）
- 如果无法确定是否需要代码修改，请分类为 bug
- question 的 replyMessage 应友好、专业，尽量给出有帮助的回答方向
- spam 的 replyMessage 应简短说明关闭原因
- question/spam 的 replyMessage 末尾必须加上提示："\\n\\n---\\n> 如果你认为这个 Issue 确实需要代码修改，请添加 \`approved\` 标签以重新触发处理流程。"`;

const VALID_CLASSIFICATIONS: TriageClassification[] = ["bug", "feature", "question", "spam"];

const TriageResultSchema = z.object({
  classification: z.enum(["bug", "feature", "question", "spam"])
    .describe("Issue 分类：bug=缺陷/回归, feature=新功能/增强, question=提问/咨询, spam=垃圾信息"),
  reason: z.string()
    .describe("分类原因（中文简述）"),
  replyMessage: z.string().optional()
    .describe("仅 question/spam 时需要的友好中文回复消息，Markdown 格式"),
});

/**
 * 从 ~/.claude/settings.json 读取环境变量配置
 */
function readClaudeSettings(): Record<string, string> {
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  try {
    const content = fs.readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(content);
    return settings.env || {};
  } catch {
    return {};
  }
}

/**
 * 使用 AI 对 Issue 进行分类
 */
export async function triageIssue(
  issueTitle: string,
  issueBody: string,
  issueLabels: string[],
): Promise<Result<TriageResult>> {
  const claudeEnv = readClaudeSettings();
  const apiKey = process.env.DEEPSEEK_API_KEY || claudeEnv.DEEPSEEK_API_KEY || "sk-099e5ef9e54d4a1f8760dd9e541cf5fd";

  if (!apiKey) {
    logger.warn("未设置 DEEPSEEK_API_KEY，跳过分类，默认为 bug");
    return success({ classification: "bug", reason: "缺少 API Key，默认为 bug" });
  }

  const modelName = process.env.ALONG_TRIAGE_MODEL || "deepseek-chat";
  const truncatedBody = (issueBody || "").slice(0, 4000);
  const userMessage = `## Issue 标题\n${issueTitle}\n\n## Issue 正文\n${truncatedBody || "（空）"}\n\n## 标签\n${issueLabels.length > 0 ? issueLabels.join(", ") : "（无标签）"}`;

  logger.info(`[triage] model=${modelName}, apiKey=${apiKey.slice(0, 8)}...`);

  try {
    const llm = new ChatOpenAI({
      model: modelName,
      temperature: 0,
      maxTokens: 1024,
      configuration: {
        baseURL: "https://api.deepseek.com",
        apiKey,
      },
    });

    const structuredLlm = llm.withStructuredOutput(TriageResultSchema, {
      name: "classify_issue",
      method: "functionCalling",
    });

    const result = await structuredLlm.invoke([
      { role: "system", content: TRIAGE_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ]);

    logger.info(`[triage] 分类结果: ${JSON.stringify(result)}`);

    if (!VALID_CLASSIFICATIONS.includes(result.classification)) {
      logger.warn(`AI 返回未知分类: ${result.classification}，默认 bug`);
      return success({ classification: "bug", reason: "未知分类结果，默认为 bug" });
    }

    return success({
      classification: result.classification,
      reason: result.reason || "",
      replyMessage: result.replyMessage,
    });
  } catch (error: any) {
    logger.error(`[triage] AI 分类失败: ${error.message}`);
    return success({ classification: "bug", reason: `AI 分类异常，默认为 bug: ${error.message}` });
  }
}

/**
 * 分类到 GitHub 标签的映射
 */
const CLASSIFICATION_LABELS: Record<TriageClassification, string> = {
  bug: "bug",
  feature: "enhancement",
  question: "question",
  spam: "spam",
};

/**
 * 根据分类结果处理 Issue
 */
export async function handleTriagedIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  result: TriageResult,
): Promise<Result<void>> {
  const tokenRes = await readGithubToken();
  if (!tokenRes.success) {
    logger.error(`获取 GitHub Token 失败: ${tokenRes.error}`);
    return failure(tokenRes.error);
  }

  const client = new GitHubClient(tokenRes.data, owner, repo);
  const typeLabel = CLASSIFICATION_LABELS[result.classification];

  switch (result.classification) {
    case "bug":
    case "feature": {
      // 打类型标签 + WIP 标签
      const addRes = await client.addIssueLabels(issueNumber, [typeLabel, "WIP"]);
      if (!addRes.success) logger.warn(`打标签失败: ${addRes.error}`);
      logger.info(`Issue #${issueNumber} 已标记 [${typeLabel}, WIP]`);

      // 启动 phase1（出方案）
      const launchRes = await launchIssueAgent(owner, repo, issueNumber, "phase1", { title: `Issue #${issueNumber}` });
      if (!launchRes.success) return launchRes;
      break;
    }

    case "question": {
      // 打标签 + 回复
      const addRes = await client.addIssueLabels(issueNumber, [typeLabel]);
      if (!addRes.success) logger.warn(`打标签失败: ${addRes.error}`);
      logger.info(`Issue #${issueNumber} 已标记 [${typeLabel}]`);

      if (result.replyMessage) {
        const commentRes = await client.addIssueComment(issueNumber, result.replyMessage);
        if (!commentRes.success) logger.warn(`回复失败: ${commentRes.error}`);
        logger.info(`已回复 Issue #${issueNumber}`);
      }
      break;
    }

    case "spam": {
      // 打标签 + 回复 + 关闭
      const addRes = await client.addIssueLabels(issueNumber, [typeLabel]);
      if (!addRes.success) logger.warn(`打标签失败: ${addRes.error}`);
      logger.info(`Issue #${issueNumber} 已标记 [${typeLabel}]`);

      if (result.replyMessage) {
        const commentRes = await client.addIssueComment(issueNumber, result.replyMessage);
        if (!commentRes.success) logger.warn(`回复失败: ${commentRes.error}`);
        logger.info(`已回复 Issue #${issueNumber}`);
      }

      await client.closeIssue(issueNumber);
      logger.info(`Issue #${issueNumber} 已关闭（spam）`);
      break;
    }
  }
  return success(undefined);
}
