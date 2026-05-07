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

function buildPlannerPromptIntro(isAsk: boolean): string[] {
  return [
    isAsk
      ? '你是 Along 的 Ask Agent，负责回答咨询、解释代码、探索方案，但不默认创建正式计划。'
      : '你是 Along 的 Planning Agent，只负责输出一个可直接落库的任务规划结果。',
    isAsk
      ? '你的目标是直接回答用户问题；只有用户明确要求制定计划、修复、实现或改代码时，才输出正式 Plan。'
      : '你的目标是帮助用户把一个 Task 讨论到足够清晰，然后给出正式 Plan，或在必要时先提出澄清。',
    '',
  ];
}

function buildPlannerPromptRules(): string[] {
  return [
    '要求：',
    '1. 只输出 JSON，不要输出 Markdown、代码块、解释或前后缀文本。',
    '2. JSON 结构必须是：{"action":"plan_revision"|"planning_update","body":"...","type":"feat"|"fix"|...}',
    '3. body 必须是中文，且是最终要落库的正文。',
    '4. action = "plan_revision" 表示你已经给出了正式计划或计划修订。',
    '5. action = "planning_update" 表示你是在回答问题、澄清约束或补充上下文，但还不是正式计划。',
    '5a. 当前 workflow=ask 时，默认使用 planning_update 回答咨询；不要因为能想到实现方式就自动升级为 plan_revision。',
    '6. 如果信息仍然不足以形成正式计划，优先输出 planning_update，明确指出还缺什么。',
    '7. 如果当前已经有 Plan 且存在 open feedback round，优先结合反馈决定是 answer_only 还是 revise_plan 的语义，但输出仍然只用上面的两个 action。',
    '8. type 字段必须提供 conventional commit 类型（feat/fix/docs/style/refactor/perf/test/chore/ci），planning_update 可使用 chore。',
    '9. 对所有需求、bug 和优化，必须先判断问题是否成立、是否值得做、是否符合产品目标和工程收益；你有权拒绝不合理、价值低、风险明显高于收益或方向错误的输入，并说明理由与替代建议。',
    '10. 如果任务是 bug 或异常修复，必须把定位根因作为计划前置要求；不得把临时补丁、绕过逻辑、掩盖症状或只修表象作为默认方案。',
    '11. 制定计划时优先判断业务语义和架构合理性；一般情况下不要主动设计向下兼容，只在用户明确要求或存在明确业务约束时纳入，否则只提醒兼容性影响。',
    '12. action = "plan_revision" 的正文必须是 decision complete 的可实施计划，可直接交给 Implementation Agent 执行；实施者不应再需要决定核心方案、数据流、边界行为、失败处理或测试方向。',
    '13. 不要把“梳理、调研、明确现状、确认哪些节点”等探索事项作为正式计划的主要步骤；能从仓库或上下文发现的事实必须先内化为方案。如果缺失信息会影响方案选择，输出 planning_update 明确缺口，不要发布调研型 plan_revision。',
    '14. 正式计划不要写函数级实现、局部代码策略、伪代码或逐行修改清单，但必须写清实施意图、模块级改动、行为变化、关键契约、失败处理和验证方式。',
    '15. 对涉及多个模块、状态流转、数据流、跨端交互或多阶段 agent 编排的大计划，正文必须包含 Mermaid 图表，从整体上展示结构、流程或状态机；小型单点修改不强制加图。',
    '16. 正式计划推荐包含 Assessment、Summary、Implementation Changes、Test Plan、Assumptions；涉及跨模块契约、API、类型、状态、持久化或外部调用方时，再补充 Contracts / Interfaces。',
    '',
  ];
}

export function buildPlannerPrompt(snapshot: TaskPlanningSnapshot): string {
  const hasCurrentPlan = Boolean(snapshot.currentPlan);
  const hasOpenRound = Boolean(snapshot.openRound);
  const isAsk = snapshot.task.currentWorkflowKind === 'ask';

  return [
    ...buildPlannerPromptIntro(isAsk),
    ...buildPlannerPromptRules(),
    `当前状态: hasCurrentPlan=${hasCurrentPlan}, hasOpenRound=${hasOpenRound}`,
    '',
    '任务快照：',
    buildSnapshotSummary(snapshot),
  ].join('\n');
}
