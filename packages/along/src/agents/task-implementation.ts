import type { TaskAutoCommitFailure } from '../domain/task-auto-commit-types';
import type {
  TaskPlanningSnapshot,
  TaskPlanRevisionRecord,
} from '../domain/task-planning';

function truncateText(value: string, maxLength = 5000): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...（内容已截断）`;
}

function buildImplementationContext(
  snapshot: TaskPlanningSnapshot,
  approvedPlan: TaskPlanRevisionRecord,
  worktreePath: string,
): Record<string, unknown> {
  return {
    task: {
      taskId: snapshot.task.taskId,
      title: snapshot.task.title,
      body: truncateText(snapshot.task.body, 4000),
      repoOwner: snapshot.task.repoOwner,
      repoName: snapshot.task.repoName,
      sourceCwd: snapshot.task.cwd,
      worktreePath,
    },
    approvedPlan: {
      planId: approvedPlan.planId,
      version: approvedPlan.version,
      body: truncateText(approvedPlan.body, 8000),
    },
    recentArtifacts: snapshot.artifacts.slice(-30).map((artifact) => ({
      artifactId: artifact.artifactId,
      type: artifact.type,
      role: artifact.role,
      body: truncateText(artifact.body, 2500),
      metadata: artifact.metadata,
    })),
  };
}

export function buildImplementationPrompt(
  snapshot: TaskPlanningSnapshot,
  approvedPlan: TaskPlanRevisionRecord,
  worktreePath: string,
): string {
  return [
    '你是 Along 的 Implementation Agent。你的任务是在当前 Task 专属 worktree 中严格按已批准方案完成代码实现。',
    '',
    '要求：',
    '1. 不重新制定计划，不扩大需求范围。',
    '2. 修改代码前先检查当前 worktree 状态和相关代码。',
    '3. 只修改完成已批准方案所必需的文件。',
    '4. 需要测试时，优先运行相关的局部测试或类型检查。',
    '5. 不要创建 PR，不要提交或推送代码；本阶段只完成工作区代码改动和必要验证。',
    '6. 最终回复必须简短说明改了什么、验证了什么、还有什么风险。',
    '',
    '任务上下文：',
    JSON.stringify(
      buildImplementationContext(snapshot, approvedPlan, worktreePath),
      null,
      2,
    ),
  ].join('\n');
}

export interface AutoCommitFixPromptInput {
  snapshot: TaskPlanningSnapshot;
  approvedPlan: TaskPlanRevisionRecord;
  worktreePath: string;
  failure: TaskAutoCommitFailure;
  attempt: number;
  maxAttempts: number;
}

function formatFailureArtifact(failure: TaskAutoCommitFailure): string {
  return failure.failureArtifactId
    ? `完整日志 artifact：${failure.failureArtifactId}`
    : '完整日志 artifact：记录失败';
}

function formatChangedFiles(failure: TaskAutoCommitFailure): string {
  return failure.changedFiles.length > 0
    ? failure.changedFiles.map((file) => `- ${file}`).join('\n')
    : '- 未能从 git status 解析到文件';
}

function buildFixPromptContext(
  input: AutoCommitFixPromptInput,
): Record<string, unknown> {
  return {
    task: {
      taskId: input.snapshot.task.taskId,
      title: input.snapshot.task.title,
      body: truncateText(input.snapshot.task.body, 4000),
    },
    approvedPlan: {
      planId: input.approvedPlan.planId,
      version: input.approvedPlan.version,
      body: truncateText(input.approvedPlan.body, 8000),
    },
  };
}

export function buildAutoCommitFixPrompt(
  input: AutoCommitFixPromptInput,
): string {
  return [
    '你是 Along 的 Implementation Agent。系统在实施阶段结束后的 auto-commit 子步骤中发现质量门禁或 git commit 失败。',
    '',
    '你的任务：基于当前 Task 专属 worktree 修复导致 commit 失败的问题，然后结束本轮修复。',
    '',
    '要求：',
    '1. 不重新制定计划，不扩大需求范围。',
    '2. 只修改修复 auto-commit 失败所必需的文件。',
    '3. 优先根据错误信息修复 biome、类型、测试或 commit hook 问题。',
    '4. 不要创建 PR，不要提交或推送代码；系统会在你完成后重新尝试 commit。',
    '5. 最终回复简短说明修复了什么、验证了什么、还有什么风险。',
    '',
    `修复尝试：${input.attempt}/${input.maxAttempts}`,
    `worktree：${input.worktreePath}`,
    `失败命令：${input.failure.command}`,
    formatFailureArtifact(input.failure),
    '',
    '错误摘要：',
    input.failure.summary,
    '',
    '相关文件：',
    formatChangedFiles(input.failure),
    '',
    '任务上下文：',
    JSON.stringify(buildFixPromptContext(input), null, 2),
  ].join('\n');
}
