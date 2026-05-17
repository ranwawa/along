import {
  areExecStepsApproved,
  findExecStepsArtifact,
} from '../task/exec-steps';
import {
  AGENT_RUN_STATUS,
  TASK_AGENT_STAGE,
  type TaskAgentStage,
  type TaskAgentStageRecord,
  type TaskArtifactRecord,
  type TaskFeedbackRoundRecord,
  type TaskFlowStageId,
  type TaskItemRecord,
  type TaskPlanRevisionRecord,
  type TaskThreadRecord,
  THREAD_STATUS,
  WORKFLOW_KIND,
} from './';
import {
  isPlanningApproved,
  isTaskCancelled,
  isTaskDelivered,
  isTaskDelivering,
  isTaskExecing,
  isTaskImplemented,
  LONG_RUNNING_THRESHOLD_MS,
} from './flow-status';

export const TASK_FLOW_STAGE_ORDER: TaskFlowStageId[] = [
  'chat',
  'requirements',
  'plan_discussion',
  'plan_confirmation',
  'exec',
  'delivery',
  'completed',
];

export const TASK_FLOW_STAGE_LABELS: Record<TaskFlowStageId, string> = {
  chat: '对话讨论',
  requirements: '需求接收',
  plan_discussion: '计划讨论',
  plan_confirmation: '计划确认',
  exec: '实现执行',
  delivery: '结果交付',
  completed: '已完成',
};

export function getStageByAgentStage(
  stages: TaskAgentStageRecord[],
  stage: TaskAgentStage,
): TaskAgentStageRecord | undefined {
  return stages.find((item) => item.stage === stage);
}

export function getLatestFailedAgentStage(
  stages: TaskAgentStageRecord[],
): TaskAgentStageRecord | undefined {
  return stages
    .filter((stage) => stage.status === AGENT_RUN_STATUS.FAILED)
    .sort((left, right) =>
      (
        right.latestRun?.endedAt ||
        right.latestRun?.startedAt ||
        ''
      ).localeCompare(
        left.latestRun?.endedAt || left.latestRun?.startedAt || '',
      ),
    )[0];
}

function getFailedStageFlowId(
  failedStage: TaskAgentStageRecord | undefined,
): TaskFlowStageId | undefined {
  if (!failedStage) return undefined;
  if (failedStage.stage === TASK_AGENT_STAGE.PLANNING) return 'plan_discussion';
  if (failedStage.stage === TASK_AGENT_STAGE.EXEC) return 'exec';
  if (failedStage.stage === TASK_AGENT_STAGE.DELIVERY) return 'delivery';
  return undefined;
}

function getStageIdFromRunning(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  agentStages: TaskAgentStageRecord[];
}): TaskFlowStageId | undefined {
  const planningStage = getStageByAgentStage(
    input.agentStages,
    TASK_AGENT_STAGE.PLANNING,
  );
  if (
    !input.currentPlan &&
    (input.thread.status === THREAD_STATUS.DRAFTING ||
      planningStage?.status === AGENT_RUN_STATUS.RUNNING)
  ) {
    return planningStage?.status === AGENT_RUN_STATUS.RUNNING
      ? 'plan_discussion'
      : 'requirements';
  }
  if (input.thread.status === THREAD_STATUS.AWAITING_APPROVAL) {
    return 'plan_confirmation';
  }
  if (isTaskExecing(input)) return 'exec';
  const execStage = getStageByAgentStage(
    input.agentStages,
    TASK_AGENT_STAGE.EXEC,
  );
  if (execStage?.status === AGENT_RUN_STATUS.RUNNING) return 'exec';
  if (isTaskImplemented(input.task)) return 'delivery';
  if (isTaskDelivering(input)) return 'delivery';
  const deliveryStage = getStageByAgentStage(
    input.agentStages,
    TASK_AGENT_STAGE.DELIVERY,
  );
  if (deliveryStage?.status === AGENT_RUN_STATUS.RUNNING) return 'delivery';
  if (isPlanningApproved(input)) return 'exec';
  return undefined;
}

export function getCurrentTaskFlowStageId(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  agentStages: TaskAgentStageRecord[];
}): TaskFlowStageId {
  if (isTaskCancelled(input.task)) return 'completed';
  if (input.task.currentWorkflowKind === WORKFLOW_KIND.PLAN) return 'chat';
  if (isTaskDelivered(input.task)) return 'delivery';
  if (input.openRound) return 'plan_discussion';
  const failedId = getFailedStageFlowId(
    getLatestFailedAgentStage(input.agentStages),
  );
  if (failedId) return failedId;
  const runningId = getStageIdFromRunning(input);
  if (runningId) return runningId;
  return input.currentPlan ? 'plan_confirmation' : 'plan_discussion';
}

function getAgentStageSummary(
  agentStage: TaskAgentStageRecord | undefined,
): string | undefined {
  if (agentStage?.status === AGENT_RUN_STATUS.FAILED)
    return `${agentStage.label}失败`;
  if (agentStage?.status === AGENT_RUN_STATUS.RUNNING) {
    return agentStage.latestRun && isLongRunningRun(agentStage.latestRun)
      ? '运行时间较长'
      : '正在运行';
  }
  return undefined;
}

function getStageTextSummary(input: {
  stageId: TaskFlowStageId;
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  artifacts: TaskArtifactRecord[];
}): string {
  switch (input.stageId) {
    case 'chat':
      if (input.thread.status === THREAD_STATUS.ANSWERED) return '已回答';
      if (input.thread.status === THREAD_STATUS.WAITING_USER) return '待补充';
      return '对话中';
    case 'requirements':
      return '任务目标和上下文已记录';
    case 'plan_discussion':
      if (input.openRound) return `开放反馈轮次 ${input.openRound.roundId}`;
      return input.currentPlan ? '计划已产出' : '等待计划输出';
    case 'plan_confirmation':
      return input.thread.status === THREAD_STATUS.AWAITING_APPROVAL
        ? '等待用户确认'
        : input.thread.approvedPlanId
          ? '计划已确认'
          : '尚未进入确认';
    case 'exec':
      return getExecStageSummary(input);
    case 'delivery':
      if (isTaskDelivered(input.task)) return '结果已交付';
      if (isTaskImplemented(input.task)) return '等待交付';
      if (isTaskDelivering(input)) return '交付中';
      return '等待实现完成';
    case 'completed':
      if (isTaskCancelled(input.task)) return '任务已关闭';
      return '任务已完成';
    default:
      return TASK_FLOW_STAGE_LABELS[input.stageId];
  }
}

export function getTaskFlowStageSummary(input: {
  stageId: TaskFlowStageId;
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  artifacts: TaskArtifactRecord[];
  agentStages: TaskAgentStageRecord[];
}): string {
  const agentStage =
    input.stageId === 'plan_discussion'
      ? getStageByAgentStage(input.agentStages, TASK_AGENT_STAGE.PLANNING)
      : input.stageId === 'exec'
        ? getStageByAgentStage(input.agentStages, TASK_AGENT_STAGE.EXEC)
        : input.stageId === 'delivery'
          ? getStageByAgentStage(input.agentStages, TASK_AGENT_STAGE.DELIVERY)
          : undefined;
  return getAgentStageSummary(agentStage) ?? getStageTextSummary(input);
}

function isLongRunningRun(run: { startedAt: string }): boolean {
  const startedAt = new Date(run.startedAt).getTime();
  if (Number.isNaN(startedAt)) return false;
  return Date.now() - startedAt > LONG_RUNNING_THRESHOLD_MS;
}

function getExecStageSummary(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  artifacts: TaskArtifactRecord[];
}): string {
  if (isTaskImplemented(input.task)) return '实现已完成';
  if (!input.thread.approvedPlanId) return '等待计划批准';
  const approvedPlan =
    input.currentPlan?.planId === input.thread.approvedPlanId
      ? input.currentPlan
      : null;
  const steps = approvedPlan
    ? findExecStepsArtifact(input, approvedPlan)
    : undefined;
  const approved = approvedPlan
    ? areExecStepsApproved(input, approvedPlan)
    : false;
  if (steps && !approved) return '等待确认实施步骤';
  if (approved) return '实施步骤已确认';
  return '等待启动实现';
}
