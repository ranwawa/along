import {
  areExecStepsApproved,
  findExecStepsArtifact,
} from '../task/exec-steps';
import {
  type TaskAgentRunRecord,
  type TaskAgentStageRecord,
  type TaskArtifactRecord,
  type TaskFeedbackRoundRecord,
  type TaskFlowAction,
  type TaskFlowStageId,
  type TaskItemRecord,
  type TaskPlanRevisionRecord,
  type TaskThreadRecord,
  THREAD_STATUS,
  WORKFLOW_KIND,
} from './';
import { buildExecModeActions } from './flow-exec-actions';
import { getLatestFailedAgentStage } from './flow-stages';
import {
  isTaskCancelled,
  isTaskCompleted,
  isTaskDelivered,
  isTaskImplemented,
  LONG_RUNNING_THRESHOLD_MS,
} from './flow-status';

const FAILURE_SUMMARY_MAX_LENGTH = 120;

export function getAgentRunFailureSummary(run: TaskAgentRunRecord): string {
  if (!run.error) return 'Agent 运行失败，需要人工查看运行记录后接管。';
  const firstLine = run.error
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return 'Agent 运行失败，需要人工查看运行记录后接管。';
  return firstLine.length > FAILURE_SUMMARY_MAX_LENGTH
    ? `${firstLine.slice(0, FAILURE_SUMMARY_MAX_LENGTH)}...`
    : firstLine;
}

type ConclusionResult = Pick<
  {
    conclusion: string;
    severity: 'normal' | 'warning' | 'blocked' | 'success';
  },
  'conclusion' | 'severity'
>;

export function buildTaskFlowConclusion(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  artifacts: TaskArtifactRecord[];
  failedStage?: TaskAgentStageRecord;
  runningStage?: TaskAgentStageRecord;
}): ConclusionResult {
  if (isTaskCancelled(input.task)) {
    return { conclusion: '任务已关闭，不再继续推进。', severity: 'blocked' };
  }
  if (isTaskCompleted(input.task)) {
    return { conclusion: '任务已完成，关键产物已归档。', severity: 'success' };
  }
  if (input.task.currentWorkflowKind === WORKFLOW_KIND.PLAN) {
    return buildChatConclusion(input.thread.status);
  }
  if (isTaskDelivered(input.task)) {
    return {
      conclusion: '结果已交付，等待验收或继续修改。',
      severity: 'success',
    };
  }
  if (input.failedStage?.latestRun) {
    return {
      conclusion: `${input.failedStage.label}失败，需要人工接管。`,
      severity: 'blocked',
    };
  }
  if (input.openRound) {
    return {
      conclusion: '当前反馈轮次已打开，等待 Planner 处理你的补充反馈。',
      severity: 'warning',
    };
  }
  return buildActiveConclusionTail(input);
}

function buildChatConclusion(status: string): ConclusionResult {
  if (status === THREAD_STATUS.ANSWERED) {
    return {
      conclusion: '咨询已回答，可以继续追问或转为计划。',
      severity: 'success',
    };
  }
  if (status === THREAD_STATUS.WAITING_USER) {
    return { conclusion: '当前咨询需要补充信息。', severity: 'warning' };
  }
  return { conclusion: '咨询正在处理中。', severity: 'normal' };
}

function buildActiveConclusionTail(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  artifacts: TaskArtifactRecord[];
  runningStage?: TaskAgentStageRecord;
}): ConclusionResult {
  if (input.runningStage?.latestRun) {
    const attention = isLongRunningStage(input.runningStage);
    return {
      conclusion: attention
        ? `${input.runningStage.label}运行时间较长，需要关注或人工接管。`
        : `${input.runningStage.label}正在执行。`,
      severity: attention ? 'warning' : 'normal',
    };
  }
  if (
    input.thread.status === THREAD_STATUS.AWAITING_APPROVAL &&
    input.currentPlan
  ) {
    return { conclusion: '等待你确认计划。', severity: 'normal' };
  }
  const approvedConclusion = buildApprovedConclusion(input);
  if (approvedConclusion) return approvedConclusion;
  if (isTaskImplemented(input.task)) {
    return {
      conclusion: '实现已完成，可以提交并创建 PR。',
      severity: 'normal',
    };
  }
  if (!input.currentPlan) {
    return {
      conclusion: '需求已接收，等待 Planner 输出计划。',
      severity: 'normal',
    };
  }
  return { conclusion: '任务正在计划流程中。', severity: 'normal' };
}

function buildApprovedConclusion(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  artifacts: TaskArtifactRecord[];
}): ConclusionResult | null {
  if (!input.thread.approvedPlanId) return null;
  const approvedPlan =
    input.currentPlan?.planId === input.thread.approvedPlanId
      ? input.currentPlan
      : null;
  const steps = approvedPlan
    ? findExecStepsArtifact(input, approvedPlan)
    : undefined;
  const stepsApproved = approvedPlan
    ? areExecStepsApproved(input, approvedPlan)
    : false;
  if (steps && !stepsApproved) {
    return {
      conclusion: '实施步骤已产出，等待你确认后开始编码。',
      severity: 'normal',
    };
  }
  return {
    conclusion: stepsApproved
      ? '实施步骤已确认，可以开始编码。'
      : '计划已确认，可以先产出实施步骤。',
    severity: 'normal',
  };
}

function isLongRunningStage(stage: TaskAgentStageRecord): boolean {
  if (!stage.latestRun) return false;
  const startedAt = new Date(stage.latestRun.startedAt).getTime();
  if (Number.isNaN(startedAt)) return false;
  return Date.now() - startedAt > LONG_RUNNING_THRESHOLD_MS;
}

export function buildTaskFlowAction(
  input: Omit<TaskFlowAction, 'enabled'> & {
    enabled: boolean;
    disabledReason?: string;
  },
): TaskFlowAction {
  return {
    id: input.id,
    label: input.label,
    description: input.description,
    enabled: input.enabled,
    disabledReason: input.enabled ? undefined : input.disabledReason,
    stage: input.stage,
    variant: input.variant,
  };
}

export function buildRetryFailedStageAction(
  failedStage: TaskAgentStageRecord | undefined,
  stage: TaskFlowStageId,
): TaskFlowAction {
  return buildTaskFlowAction({
    id: 'resume_failed_stage',
    label: '重试',
    description: failedStage
      ? `恢复失败会话并重试${failedStage.label}`
      : '恢复失败会话并重试最近失败阶段',
    enabled: Boolean(failedStage),
    disabledReason: '当前没有失败阶段可重试',
    stage,
    variant: 'primary',
  });
}

function buildPlanModeActions(input: {
  agentStages: TaskAgentStageRecord[];
}): TaskFlowAction[] {
  const failedStage = getLatestFailedAgentStage(input.agentStages);
  return [
    buildTaskFlowAction({
      id: 'submit_feedback',
      label: '继续提问',
      description: '补充问题或继续当前咨询',
      enabled: true,
      stage: 'chat',
      variant: 'secondary',
    }),
    buildTaskFlowAction({
      id: 'request_plan',
      label: '转为计划',
      description: '把当前咨询切换为正式计划流程',
      enabled: true,
      stage: 'chat',
      variant: 'primary',
    }),
    ...(failedStage ? [buildRetryFailedStageAction(failedStage, 'chat')] : []),
    buildTaskFlowAction({
      id: 'close_task',
      label: '关闭任务',
      description: '结束当前咨询并保留历史记录',
      enabled: true,
      stage: 'chat',
      variant: 'danger',
    }),
  ];
}

export function buildTaskFlowActions(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  artifacts: TaskArtifactRecord[];
  agentStages: TaskAgentStageRecord[];
}): TaskFlowAction[] {
  if (isTaskCancelled(input.task)) return [];
  if (input.task.currentWorkflowKind === WORKFLOW_KIND.PLAN) {
    return buildPlanModeActions(input);
  }
  return buildExecModeActions(input);
}
