import type { TaskAutoCommitFailure } from '../domain/task-auto-commit-types';
import type {
  TaskPlanningSnapshot,
  TaskPlanRevisionRecord,
} from '../domain/task-planning';
import {
  loadWorkflowNodePrompt,
  renderAgentMarkdownTemplate,
} from './workflow-node-prompt-loader';

const DEFAULT_TEXT_LIMIT = 5000;
const TASK_BODY_CONTEXT_LIMIT = 4000;
const PLAN_BODY_CONTEXT_LIMIT = 8000;
const RECENT_ARTIFACT_COUNT = 30;
const ARTIFACT_CONTEXT_LIMIT = 2500;
const BUILDER_EXEC_PROMPT_ID = 'builder-exec';
const BUILDER_TACTICAL_PLAN_PROMPT_ID = 'builder-tactical-plan';
const AUTO_COMMIT_FIX_PROMPT_ID = 'auto-commit-fix';

function truncateText(value: string, maxLength = DEFAULT_TEXT_LIMIT): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...（内容已截断）`;
}

function buildExecContext(
  snapshot: TaskPlanningSnapshot,
  approvedPlan: TaskPlanRevisionRecord,
  worktreePath: string,
): Record<string, unknown> {
  return {
    task: {
      taskId: snapshot.task.taskId,
      title: snapshot.task.title,
      body: truncateText(snapshot.task.body, TASK_BODY_CONTEXT_LIMIT),
      repoOwner: snapshot.task.repoOwner,
      repoName: snapshot.task.repoName,
      sourceCwd: snapshot.task.cwd,
      worktreePath,
    },
    approvedPlan: {
      planId: approvedPlan.planId,
      version: approvedPlan.version,
      body: truncateText(approvedPlan.body, PLAN_BODY_CONTEXT_LIMIT),
    },
    recentArtifacts: snapshot.artifacts
      .slice(-RECENT_ARTIFACT_COUNT)
      .map((artifact) => ({
        artifactId: artifact.artifactId,
        type: artifact.type,
        role: artifact.role,
        body: truncateText(artifact.body, ARTIFACT_CONTEXT_LIMIT),
        metadata: artifact.metadata,
      })),
  };
}

export function buildExecPrompt(
  snapshot: TaskPlanningSnapshot,
  approvedPlan: TaskPlanRevisionRecord,
  worktreePath: string,
): string {
  const template = loadWorkflowNodePrompt({
    name: BUILDER_EXEC_PROMPT_ID,
  });
  return renderAgentMarkdownTemplate(template.content, {
    contextJson: JSON.stringify(
      buildExecContext(snapshot, approvedPlan, worktreePath),
      null,
      2,
    ),
  });
}

export function buildExecStepsPrompt(
  snapshot: TaskPlanningSnapshot,
  approvedPlan: TaskPlanRevisionRecord,
): string {
  const template = loadWorkflowNodePrompt({
    name: BUILDER_TACTICAL_PLAN_PROMPT_ID,
  });
  return renderAgentMarkdownTemplate(template.content, {
    contextJson: JSON.stringify(
      buildExecContext(snapshot, approvedPlan, snapshot.task.cwd || ''),
      null,
      2,
    ),
  });
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
      body: truncateText(input.snapshot.task.body, TASK_BODY_CONTEXT_LIMIT),
    },
    approvedPlan: {
      planId: input.approvedPlan.planId,
      version: input.approvedPlan.version,
      body: truncateText(input.approvedPlan.body, PLAN_BODY_CONTEXT_LIMIT),
    },
  };
}

export function buildAutoCommitFixPrompt(
  input: AutoCommitFixPromptInput,
): string {
  const template = loadWorkflowNodePrompt({
    name: AUTO_COMMIT_FIX_PROMPT_ID,
  });
  return renderAgentMarkdownTemplate(template.content, {
    attempt: String(input.attempt),
    maxAttempts: String(input.maxAttempts),
    worktreePath: input.worktreePath,
    failureCommand: input.failure.command,
    failureArtifact: formatFailureArtifact(input.failure),
    failureSummary: input.failure.summary,
    changedFiles: formatChangedFiles(input.failure),
    contextJson: JSON.stringify(buildFixPromptContext(input), null, 2),
  });
}
