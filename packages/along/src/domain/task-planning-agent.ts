import { z } from 'zod';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import { runTaskAgentTurn } from './task-agent-runtime';
import {
  publishPlanningUpdate,
  publishTaskPlanRevision,
  readTaskPlanningSnapshot,
  type TaskPlanningSnapshot,
} from './task-planning';

const PLANNER_OUTPUT_SCHEMA = z.object({
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

const PLANNER_OUTPUT_FORMAT_SCHEMA = {
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

export interface RunTaskPlanningAgentInput {
  taskId: string;
  agentId?: string;
  cwd: string;
  editor?: string;
  model?: string;
  personalityVersion?: string;
}

export interface RunTaskPlanningAgentOutput {
  snapshot: TaskPlanningSnapshot;
  action: TaskPlannerAction;
  body: string;
  assistantText: string;
}

function truncateText(value: string, maxLength = 2000): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...（内容已截断）`;
}

function buildSnapshotSummary(snapshot: TaskPlanningSnapshot): string {
  const summary = {
    task: {
      taskId: snapshot.task.taskId,
      title: snapshot.task.title,
      body: truncateText(snapshot.task.body, 4000),
      source: snapshot.task.source,
      status: snapshot.task.status,
    },
    thread: {
      threadId: snapshot.thread.threadId,
      purpose: snapshot.thread.purpose,
      status: snapshot.thread.status,
      currentPlanId: snapshot.thread.currentPlanId,
      openRoundId: snapshot.thread.openRoundId,
      approvedPlanId: snapshot.thread.approvedPlanId,
    },
    currentPlan: snapshot.currentPlan
      ? {
          planId: snapshot.currentPlan.planId,
          version: snapshot.currentPlan.version,
          status: snapshot.currentPlan.status,
          basedOnPlanId: snapshot.currentPlan.basedOnPlanId,
          body: truncateText(snapshot.currentPlan.body, 4000),
        }
      : null,
    openRound: snapshot.openRound
      ? {
          roundId: snapshot.openRound.roundId,
          basedOnPlanId: snapshot.openRound.basedOnPlanId,
          status: snapshot.openRound.status,
          feedbackArtifactIds: snapshot.openRound.feedbackArtifactIds,
        }
      : null,
    recentArtifacts: snapshot.artifacts.slice(-20).map((artifact) => ({
      artifactId: artifact.artifactId,
      type: artifact.type,
      role: artifact.role,
      body: truncateText(artifact.body, 2500),
      metadata: artifact.metadata,
    })),
    planVersions: snapshot.plans.map((plan) => ({
      planId: plan.planId,
      version: plan.version,
      status: plan.status,
      basedOnPlanId: plan.basedOnPlanId,
      body: truncateText(plan.body, 2500),
    })),
  };

  return JSON.stringify(summary, null, 2);
}

function buildPlannerPrompt(snapshot: TaskPlanningSnapshot): string {
  const hasCurrentPlan = Boolean(snapshot.currentPlan);
  const hasOpenRound = Boolean(snapshot.openRound);

  return [
    '你是 Along 的 Planning Agent，只负责输出一个可直接落库的任务规划结果。',
    '你的目标是帮助用户把一个 Task 讨论到足够清晰，然后给出正式 Plan，或在必要时先提出澄清。',
    '',
    '要求：',
    '1. 只输出 JSON，不要输出 Markdown、代码块、解释或前后缀文本。',
    '2. JSON 结构必须是：{"action":"plan_revision"|"planning_update","body":"...","type":"feat"|"fix"|...}',
    '3. body 必须是中文，且是最终要落库的正文。',
    '4. action = "plan_revision" 表示你已经给出了正式计划或计划修订。',
    '5. action = "planning_update" 表示你是在回答问题、澄清约束或补充上下文，但还不是正式计划。',
    '6. 如果信息仍然不足以形成正式计划，优先输出 planning_update，明确指出还缺什么。',
    '7. 如果当前已经有 Plan 且存在 open feedback round，优先结合反馈决定是 answer_only 还是 revise_plan 的语义，但输出仍然只用上面的两个 action。',
    '8. type 字段必须提供 conventional commit 类型（feat/fix/docs/style/refactor/perf/test/chore/ci），planning_update 可使用 chore。',
    '',
    `当前状态: hasCurrentPlan=${hasCurrentPlan}, hasOpenRound=${hasOpenRound}`,
    '',
    '任务快照：',
    buildSnapshotSummary(snapshot),
  ].join('\n');
}

function extractJsonCandidate(text: string): string | null {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) return fencedMatch[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1).trim();
  return null;
}

export function parseTaskPlannerOutput(
  text: string,
): Result<{ action: TaskPlannerAction; body: string }> {
  const raw = text.trim();
  if (!raw) return failure('Planner 输出不能为空');

  const candidate = extractJsonCandidate(raw);
  if (!candidate) return failure('Planner 输出中未找到 JSON');

  try {
    const parsed = JSON.parse(candidate) as unknown;
    const result = PLANNER_OUTPUT_SCHEMA.safeParse(parsed);
    if (!result.success) {
      return failure(`Planner 输出格式不正确: ${result.error.message}`);
    }
    return success(result.data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`解析 Planner 输出失败: ${message}`);
  }
}

export async function runTaskPlanningAgent(
  input: RunTaskPlanningAgentInput,
): Promise<Result<RunTaskPlanningAgentOutput>> {
  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${input.taskId}`);

  const prompt = buildPlannerPrompt(snapshot);
  const agentId = input.agentId || 'planner';
  const result = await runTaskAgentTurn({
    taskId: input.taskId,
    threadId: snapshot.thread.threadId,
    agentId,
    prompt,
    cwd: input.cwd,
    editor: input.editor,
    model: input.model,
    personalityVersion: input.personalityVersion,
    inputArtifactIds: snapshot.artifacts.map((artifact) => artifact.artifactId),
    options: {
      outputFormat: {
        type: 'json_schema',
        schema: PLANNER_OUTPUT_FORMAT_SCHEMA,
      },
    },
  });
  if (!result.success) return result;

  const parsed =
    result.data.structuredOutput === undefined
      ? parseTaskPlannerOutput(result.data.assistantText)
      : (() => {
          const structured = PLANNER_OUTPUT_SCHEMA.safeParse(
            result.data.structuredOutput,
          );
          return structured.success
            ? success(structured.data)
            : failure(
                `Planner 结构化输出格式不正确: ${structured.error.message}`,
              );
        })();
  if (!parsed.success) {
    return parsed;
  }

  if (parsed.data.action === 'plan_revision') {
    const publishRes = publishTaskPlanRevision({
      taskId: input.taskId,
      agentId,
      body: parsed.data.body,
      type: parsed.data.type,
    });
    if (!publishRes.success) return publishRes;
  } else {
    const updateRes = publishPlanningUpdate({
      taskId: input.taskId,
      agentId,
      body: parsed.data.body,
    });
    if (!updateRes.success) return updateRes;
  }

  const refreshedSnapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!refreshedSnapshotRes.success) return refreshedSnapshotRes;
  if (!refreshedSnapshotRes.data) {
    return failure(`Task ${input.taskId} 已更新，但读取快照失败`);
  }

  return success({
    snapshot: refreshedSnapshotRes.data,
    action: parsed.data.action,
    body: parsed.data.body,
    assistantText: result.data.assistantText,
  });
}
