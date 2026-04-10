/**
 * issue-triage.ts - Issue 分类模块（内部模块，不作为 CLI 子命令）
 *
 * 在 webhook 收到 issues.opened 事件后，使用 AI 对 Issue 进行分类：
 * - actionable: 需要代码修改，走完整 along run 流程
 * - trivial: 不需要代码修改（提问/测试/无意义），直接回复评论
 */

import Anthropic from "@anthropic-ai/sdk";
import { consola } from "consola";
import { GitHubClient, readGithubToken } from "./github-client";

const logger = consola.withTag("issue-triage");

export type TriageResult = {
  classification: "actionable" | "trivial";
  reason: string;
  replyMessage?: string;
};

const TRIAGE_SYSTEM_PROMPT = `你是一个 GitHub Issue 分类助手。你的任务是判断一个 Issue 是否需要代码修改。

请分析以下 Issue 的标题、正文和标签，并将其分类为以下两类之一：

1. **actionable**：需要代码修改的 Issue（bug 修复、新功能、改进、重构、文档修改等）
2. **trivial**：不需要代码修改的 Issue（提问、测试 Issue、无意义内容、打招呼、垃圾信息等）

请严格以 JSON 格式返回结果，不要包含其他内容：
{
  "classification": "actionable" 或 "trivial",
  "reason": "分类原因（中文简述）",
  "replyMessage": "（仅 trivial 时需要）友好的中文回复消息，Markdown 格式"
}

注意：
- 如果无法确定，请分类为 actionable（宁可多做，不可错过）
- replyMessage 应友好、专业，如果是提问则尽量给出有帮助的回答方向
- replyMessage 末尾必须加上提示："\\n\\n---\\n> 如果你认为这个 Issue 确实需要代码修改，请添加 \`approved\` 标签以重新触发处理流程。"`;

/**
 * 使用 AI 对 Issue 进行分类
 */
export async function triageIssue(
  issueTitle: string,
  issueBody: string,
  issueLabels: string[],
): Promise<TriageResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn("未设置 ANTHROPIC_API_KEY，跳过分类，使用完整流程");
    return { classification: "actionable", reason: "缺少 API Key，默认走完整流程" };
  }

  const truncatedBody = (issueBody || "").slice(0, 4000);
  const userMessage = `## Issue 标题\n${issueTitle}\n\n## Issue 正文\n${truncatedBody || "（空）"}\n\n## 标签\n${issueLabels.length > 0 ? issueLabels.join(", ") : "（无标签）"}`;

  const client = new Anthropic({ apiKey });
  const model = process.env.ALONG_TRIAGE_MODEL || "claude-3-5-haiku-latest";

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    temperature: 0,
    system: TRIAGE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  // 提取 JSON（兼容 markdown code block 包裹的情况）
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn(`AI 返回内容无法解析为 JSON，默认 actionable: ${text.slice(0, 200)}`);
    return { classification: "actionable", reason: "AI 返回格式异常，默认走完整流程" };
  }

  const parsed = JSON.parse(jsonMatch[0]);
  if (parsed.classification !== "actionable" && parsed.classification !== "trivial") {
    logger.warn(`AI 返回未知分类: ${parsed.classification}，默认 actionable`);
    return { classification: "actionable", reason: "未知分类结果，默认走完整流程" };
  }

  return {
    classification: parsed.classification,
    reason: parsed.reason || "",
    replyMessage: parsed.replyMessage,
  };
}

/**
 * 根据分类结果处理 Issue
 */
export async function handleTriagedIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  result: TriageResult,
): Promise<void> {
  if (result.classification === "trivial") {
    const tokenRes = await readGithubToken();
    if (!tokenRes.success) {
      logger.error(`获取 GitHub Token 失败: ${tokenRes.error}，回退到完整流程`);
      spawnAlongRun(issueNumber);
      return;
    }

    const client = new GitHubClient(tokenRes.data, owner, repo);

    if (result.replyMessage) {
      await client.addIssueComment(issueNumber, result.replyMessage);
      logger.info(`已回复 Issue #${issueNumber}`);
    }

    await client.addIssueLabels(issueNumber, ["triaged:trivial"]);
    logger.info(`已标记 Issue #${issueNumber} 为 triaged:trivial`);
    return;
  }

  // actionable → 走完整流程
  spawnAlongRun(issueNumber);
}

function spawnAlongRun(issueNumber: number) {
  logger.info(`Issue #${issueNumber} 分类为 actionable，启动 along run...`);
  const proc = Bun.spawn(["along", "run", String(issueNumber), "--ci"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  proc.unref();
}
