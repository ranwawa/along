/**
 * issue-triage.ts - Issue 分类模块（内部模块，不作为 CLI 子命令）
 *
 * 在 webhook 收到 issues.opened 事件后，对 Issue 进行本地分类：
 * - bug: 缺陷/回归/异常行为，需要代码修复
 * - feature: 新功能/增强/重构/文档改进，需要代码修改
 * - question: 提问/求助/咨询，不需要代码修改
 * - spam: 广告/无意义/测试内容
 */

import { consola } from 'consola';
import type {
  TriageClassification,
  TriageResult,
} from '../agents/issue-triage';
import type { Result } from '../core/common';
import { failure, success } from '../core/common';
import { GitHubClient, readGithubToken } from '../integration/github-client';
import { launchIssueAgent } from './issue-agent';
import { LIFECYCLE } from './session-state-machine';

const logger = consola.withTag('issue-triage');

function includesAny(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}

export async function triageIssue(
  issueTitle: string,
  issueBody: string,
  issueLabels: string[],
): Promise<Result<TriageResult>> {
  const labels = issueLabels.map((label) => label.toLowerCase());
  if (labels.includes('bug') || labels.includes('feature')) {
    return success({
      classification: labels.includes('feature') ? 'feature' : 'bug',
      reason: 'Issue 已包含可执行标签',
    });
  }

  const text = `${issueTitle}\n${issueBody}`.toLowerCase();
  if (includesAny(text, ['spam', '广告', '推广', 'http://', 'https://'])) {
    return success({
      classification: 'spam',
      reason: '本地规则判断为广告或无关内容',
      replyMessage:
        '该 Issue 看起来不像需要处理的代码任务，已按 spam 处理。\n\n---\n> 如果你认为这个 Issue 确实需要代码修改，请在 Issue 中评论 `/approve` 以重新触发处理流程。',
    });
  }

  if (
    includesAny(text, ['?', '？', 'how', 'why', '如何', '怎么', '请问', '咨询'])
  ) {
    return success({
      classification: 'question',
      reason: '本地规则判断为咨询类 Issue',
      replyMessage:
        '该 Issue 看起来更像咨询或求助，暂不启动代码处理流程。\n\n---\n> 如果你认为这个 Issue 确实需要代码修改，请在 Issue 中评论 `/approve` 以重新触发处理流程。',
    });
  }

  return success({
    classification: includesAny(text, ['feature', '新增', '支持', '优化'])
      ? 'feature'
      : 'bug',
    reason: '本地规则无法排除代码修改需求，默认进入 Codex 处理流程',
  });
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
