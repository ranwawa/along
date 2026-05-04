import { z } from 'zod';
import type { TaskPlanningSnapshot } from '../domain/task-planning';

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

function truncateText(value: string, maxLength = 2000): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...（内容已截断）`;
}

function buildPlanSummary(
  plan: TaskPlanningSnapshot['currentPlan'],
  maxLength = 2500,
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
    body: truncateText(artifact.body, 2500),
    metadata: artifact.metadata,
  };
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
    currentPlan: buildPlanSummary(snapshot.currentPlan, 4000),
    openRound: snapshot.openRound
      ? {
          roundId: snapshot.openRound.roundId,
          basedOnPlanId: snapshot.openRound.basedOnPlanId,
          status: snapshot.openRound.status,
          feedbackArtifactIds: snapshot.openRound.feedbackArtifactIds,
        }
      : null,
    recentArtifacts: snapshot.artifacts.slice(-20).map(buildArtifactSummary),
    planVersions: snapshot.plans.map((plan) => buildPlanSummary(plan)),
  };

  return JSON.stringify(summary, null, 2);
}

export function buildPlannerPrompt(snapshot: TaskPlanningSnapshot): string {
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
    '9. 如果任务是 bug 或异常修复，必须把定位根因作为计划前置要求；不得把临时补丁、绕过逻辑、掩盖症状或只修表象作为默认方案。',
    '10. 制定计划时优先判断业务语义和架构合理性；一般情况下不要主动设计向下兼容，只在用户明确要求或存在明确业务约束时纳入，否则只提醒兼容性影响。',
    '11. 计划正文聚焦目标、边界、风险、验证和交付标准；如无必要，不要写具体代码实现细节，实施细节交由 Implementation Agent 处理。',
    '',
    `当前状态: hasCurrentPlan=${hasCurrentPlan}, hasOpenRound=${hasOpenRound}`,
    '',
    '任务快照：',
    buildSnapshotSummary(snapshot),
  ].join('\n');
}
