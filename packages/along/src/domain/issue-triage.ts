/**
 * issue-triage.ts - Issue 分类模块（内部模块，不作为 CLI 子命令）
 *
 * 在 webhook 收到 issues.opened 事件后，使用 AI 对 Issue 进行分类：
 * - bug: 缺陷/回归/异常行为，需要代码修复
 * - feature: 新功能/增强/重构/文档改进，需要代码修改
 * - question: 提问/求助/咨询，不需要代码修改
 * - spam: 广告/无意义/测试内容
 */

import { ChatOpenAI } from '@langchain/openai';
import { consola } from 'consola';
import {
  TRIAGE_CLASSIFICATIONS,
  TRIAGE_SYSTEM_PROMPT,
  type TriageClassification,
  type TriageResult,
  TriageResultSchema,
} from '../agents/issue-triage';
import type { Result } from '../core/common';
import { failure, success } from '../core/common';
import { GitHubClient, readGithubToken } from '../integration/github-client';
import { launchIssueAgent } from './issue-agent';
import { LIFECYCLE } from './session-state-machine';

const logger = consola.withTag('issue-triage');

function buildTriageUserMessage(
  issueTitle: string,
  issueBody: string,
  issueLabels: string[],
): string {
  const truncatedBody = (issueBody || '').slice(0, 4000);
  const labelText =
    issueLabels.length > 0 ? issueLabels.join(', ') : '（无标签）';
  return `## Issue 标题\n${issueTitle}\n\n## Issue 正文\n${truncatedBody || '（空）'}\n\n## 标签\n${labelText}`;
}

function createTriageLlm(apiKey: string, modelName: string) {
  const llm = new ChatOpenAI({
    model: modelName,
    temperature: 0,
    maxTokens: 1024,
    configuration: {
      baseURL: 'https://api.deepseek.com',
      apiKey,
    },
  });

  return llm.withStructuredOutput(TriageResultSchema, {
    name: 'classify_issue',
    method: 'functionCalling',
  });
}

function normalizeTriageResult(result: TriageResult): TriageResult {
  if (TRIAGE_CLASSIFICATIONS.includes(result.classification)) {
    return {
      classification: result.classification,
      reason: result.reason || '',
      replyMessage: result.replyMessage,
    };
  }

  logger.warn(`AI 返回未知分类: ${result.classification}，默认 bug`);
  return {
    classification: 'bug',
    reason: '未知分类结果，默认为 bug',
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function triageIssue(
  issueTitle: string,
  issueBody: string,
  issueLabels: string[],
): Promise<Result<TriageResult>> {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    logger.warn('未设置 DEEPSEEK_API_KEY，无法进行分类');
    return failure('缺少 DEEPSEEK_API_KEY，无法进行 Issue 分类');
  }

  const modelName = process.env.ALONG_TRIAGE_MODEL || 'deepseek-chat';
  const userMessage = buildTriageUserMessage(
    issueTitle,
    issueBody,
    issueLabels,
  );

  logger.info(`[triage] model=${modelName}, apiKey=${apiKey.slice(0, 8)}...`);

  try {
    const structuredLlm = createTriageLlm(apiKey, modelName);

    const result = await structuredLlm.invoke([
      { role: 'system', content: TRIAGE_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ]);

    logger.info(`[triage] 分类结果: ${JSON.stringify(result)}`);
    return success(normalizeTriageResult(result));
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    logger.error(`[triage] AI 分类失败: ${message}`);
    return failure(`AI 分类异常: ${message}`);
  }
}

/**
 * 分类到 GitHub 标签的映射
 */
const CLASSIFICATION_LABELS: Record<TriageClassification, string> = {
  bug: 'bug',
  feature: 'feature',
  question: 'question',
  spam: 'spam',
};

async function addIssueLabels(
  client: GitHubClient,
  issueNumber: number,
  labels: string[],
) {
  const addRes = await client.addIssueLabels(issueNumber, labels);
  if (!addRes.success) logger.warn(`打标签失败: ${addRes.error}`);
}

async function replyIssueIfNeeded(
  client: GitHubClient,
  issueNumber: number,
  replyMessage?: string,
) {
  if (!replyMessage) return;
  const commentRes = await client.addIssueComment(issueNumber, replyMessage);
  if (!commentRes.success) logger.warn(`回复失败: ${commentRes.error}`);
  logger.info(`已回复 Issue #${issueNumber}`);
}

async function handleCodeChangeIssue(input: {
  client: GitHubClient;
  owner: string;
  repo: string;
  issueNumber: number;
  typeLabel: string;
  options?: { skipAgentLaunch?: boolean; repoPath?: string };
}): Promise<Result<void>> {
  await addIssueLabels(input.client, input.issueNumber, [
    input.typeLabel,
    LIFECYCLE.RUNNING,
  ]);
  logger.info(
    `Issue #${input.issueNumber} 已标记 [${input.typeLabel}, ${LIFECYCLE.RUNNING}]`,
  );

  if (input.options?.skipAgentLaunch) return success(undefined);
  return launchIssueAgent(
    input.owner,
    input.repo,
    input.issueNumber,
    'planning',
    {
      trigger: 'triage',
      taskData: { title: `Issue #${input.issueNumber}` },
      repoPath: input.options?.repoPath,
    },
  );
}

async function handleReplyOnlyIssue(input: {
  client: GitHubClient;
  issueNumber: number;
  typeLabel: string;
  replyMessage?: string;
}) {
  await addIssueLabels(input.client, input.issueNumber, [input.typeLabel]);
  logger.info(`Issue #${input.issueNumber} 已标记 [${input.typeLabel}]`);
  await replyIssueIfNeeded(input.client, input.issueNumber, input.replyMessage);
}

async function handleClassifiedIssue(input: {
  client: GitHubClient;
  owner: string;
  repo: string;
  issueNumber: number;
  result: TriageResult;
  typeLabel: string;
  options?: { skipAgentLaunch?: boolean; repoPath?: string };
}): Promise<Result<void>> {
  if (
    input.result.classification === 'bug' ||
    input.result.classification === 'feature'
  ) {
    return handleCodeChangeIssue(input);
  }

  await handleReplyOnlyIssue({
    client: input.client,
    issueNumber: input.issueNumber,
    typeLabel: input.typeLabel,
    replyMessage: input.result.replyMessage,
  });

  if (input.result.classification === 'spam') {
    await input.client.closeIssue(input.issueNumber);
    logger.info(`Issue #${input.issueNumber} 已关闭（spam）`);
  }
  return success(undefined);
}

export async function handleTriagedIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  result: TriageResult,
  options?: { skipAgentLaunch?: boolean; repoPath?: string },
): Promise<Result<void>> {
  const tokenRes = await readGithubToken();
  if (!tokenRes.success) {
    logger.error(`获取 GitHub Token 失败: ${tokenRes.error}`);
    return failure(tokenRes.error);
  }

  const client = new GitHubClient(tokenRes.data, owner, repo);
  const typeLabel = CLASSIFICATION_LABELS[result.classification];

  return handleClassifiedIssue({
    client,
    owner,
    repo,
    issueNumber,
    result,
    typeLabel,
    options,
  });
}
