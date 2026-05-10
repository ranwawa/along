import { z } from 'zod';
import type { TaskPlanningSnapshot } from '../domain/task-planning';
import { renderAgentMarkdownTemplate } from './workflow-node-prompt-loader';

export const PLANNER_CONTRACT_KIND = 'planner_contract';
export const PLANNER_NODE_PROMPT_ID = 'planner';
export const PLANNER_NODE_PROMPT_VERSION = 'v1';
const DEFAULT_TEXT_LIMIT = 2000;
const PLAN_SUMMARY_LIMIT = 2500;
const ARTIFACT_SUMMARY_LIMIT = 2500;
const TASK_BODY_SUMMARY_LIMIT = 4000;
const CURRENT_PLAN_SUMMARY_LIMIT = 4000;
const RECENT_ARTIFACT_COUNT = 20;

export const PLANNER_OUTPUT_SCHEMA = z.object({
  action: z.enum(['plan_revision', 'planning_update']),
  body: z.string().min(1),
  type: z
    .enum([
      'feat',
      'fix',
      'docs',
      'style',
      'refactor',
      'perf',
      'test',
      'chore',
      'ci',
    ])
    .optional(),
});

export const PLANNER_OUTPUT_FORMAT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'body', 'type'],
  properties: {
    action: {
      type: 'string',
      enum: ['plan_revision', 'planning_update'],
    },
    body: {
      type: 'string',
      minLength: 1,
    },
    type: {
      type: 'string',
      enum: [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'chore',
        'ci',
      ],
    },
  },
};

export type TaskPlannerAction = z.infer<typeof PLANNER_OUTPUT_SCHEMA>['action'];
export type TaskPlannerOutput = z.infer<typeof PLANNER_OUTPUT_SCHEMA>;

function truncateText(value: string, maxLength = DEFAULT_TEXT_LIMIT): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...（内容已截断）`;
}

function buildPlanSummary(
  plan: TaskPlanningSnapshot['currentPlan'],
  maxLength = PLAN_SUMMARY_LIMIT,
) {
  if (!plan) return null;
  return {
    planId: plan.planId,
    version: plan.version,
    status: plan.status,
    basedOnPlanId: plan.basedOnPlanId,
    body: truncateText(plan.body, maxLength),
  };
}

function buildArtifactSummary(artifact: TaskPlanningSnapshot['artifacts'][0]) {
  return {
    artifactId: artifact.artifactId,
    type: artifact.type,
    role: artifact.role,
    body: truncateText(artifact.body, ARTIFACT_SUMMARY_LIMIT),
    metadata: artifact.metadata,
  };
}

function buildTaskSummary(snapshot: TaskPlanningSnapshot) {
  return {
    taskId: snapshot.task.taskId,
    title: snapshot.task.title,
    body: truncateText(snapshot.task.body, TASK_BODY_SUMMARY_LIMIT),
    source: snapshot.task.source,
    lifecycle: snapshot.task.lifecycle,
    currentWorkflowKind: snapshot.task.currentWorkflowKind,
    display: snapshot.display,
  };
}

function buildThreadSummary(snapshot: TaskPlanningSnapshot) {
  return {
    threadId: snapshot.thread.threadId,
    purpose: snapshot.thread.purpose,
    status: snapshot.thread.status,
    currentPlanId: snapshot.thread.currentPlanId,
    openRoundId: snapshot.thread.openRoundId,
    approvedPlanId: snapshot.thread.approvedPlanId,
  };
}

function buildOpenRoundSummary(snapshot: TaskPlanningSnapshot) {
  if (!snapshot.openRound) return null;
  return {
    roundId: snapshot.openRound.roundId,
    basedOnPlanId: snapshot.openRound.basedOnPlanId,
    status: snapshot.openRound.status,
    feedbackArtifactIds: snapshot.openRound.feedbackArtifactIds,
  };
}

function buildSnapshotSummary(snapshot: TaskPlanningSnapshot): string {
  const summary = {
    task: buildTaskSummary(snapshot),
    thread: buildThreadSummary(snapshot),
    currentPlan: buildPlanSummary(
      snapshot.currentPlan,
      CURRENT_PLAN_SUMMARY_LIMIT,
    ),
    openRound: buildOpenRoundSummary(snapshot),
    recentArtifacts: snapshot.artifacts
      .slice(-RECENT_ARTIFACT_COUNT)
      .map(buildArtifactSummary),
    planVersions: snapshot.plans.map((plan) => buildPlanSummary(plan)),
  };

  return JSON.stringify(summary, null, 2);
}

export function buildPlannerPrompt(
  snapshot: TaskPlanningSnapshot,
  input: {
    template: string;
  },
): string {
  const hasCurrentPlan = Boolean(snapshot.currentPlan);
  const hasOpenRound = Boolean(snapshot.openRound);

  return renderAgentMarkdownTemplate(input.template, {
    workflowIntro: `当前 workflow: ${snapshot.task.currentWorkflowKind}`,
    stateSummary: `workflowKind=${snapshot.task.currentWorkflowKind}, hasCurrentPlan=${hasCurrentPlan}, hasOpenRound=${hasOpenRound}`,
    snapshotJson: buildSnapshotSummary(snapshot),
  });
}
