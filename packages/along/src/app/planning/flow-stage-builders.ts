import {
  areExecStepsApproved,
  findExecStepsArtifact,
} from '../task/exec-steps';
import {
  AGENT_RUN_STATUS,
  TASK_AGENT_STAGE,
  type TaskAgentStageRecord,
  type TaskArtifactRecord,
  type TaskFeedbackRoundRecord,
  type TaskFlowStage,
  type TaskFlowStageId,
  type TaskFlowStageState,
  type TaskItemRecord,
  type TaskPlanRevisionRecord,
  type TaskThreadRecord,
  THREAD_STATUS,
  WORKFLOW_KIND,
} from './';
import { getAgentRunFailureSummary } from './flow-actions';
import {
  getLatestFailedAgentStage,
  getStageByAgentStage,
  getTaskFlowStageSummary,
  TASK_FLOW_STAGE_LABELS,
  TASK_FLOW_STAGE_ORDER,
} from './flow-stages';
import { isLongRunning, isTaskCancelled } from './flow-status';

export function buildTaskFlowStageDetails(input: {
  stageId: TaskFlowStageId;
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  plans: TaskPlanRevisionRecord[];
  artifacts: TaskArtifactRecord[];
  agentStages: TaskAgentStageRecord[];
}): string[] {
  const details: string[] = [];
  if (input.stageId === 'requirements') {
    details.push(`来源：${input.task.source}`);
    if (input.task.repoOwner && input.task.repoName) {
      details.push(`仓库：${input.task.repoOwner}/${input.task.repoName}`);
    }
  }
  if (input.stageId === 'chat') {
    details.push(`来源：${input.task.source}`);
    details.push(`消息数：${input.artifacts.length}`);
  }
  if (input.stageId === 'plan_discussion') {
    details.push(`计划版本数：${input.plans.length}`);
    if (input.openRound) {
      details.push(`反馈数：${input.openRound.feedbackArtifactIds.length}`);
    }
  }
  if (input.stageId === 'plan_confirmation' && input.currentPlan) {
    details.push(`当前计划：v${input.currentPlan.version}`);
  }
  if (input.stageId === 'exec') buildExecStageDetails(input, details);
  if (input.stageId === 'delivery') {
    if (input.task.branchName) details.push(`分支：${input.task.branchName}`);
    if (input.task.prUrl) details.push(`PR：${input.task.prUrl}`);
  }
  if (input.stageId === 'completed') {
    if (input.task.prUrl) details.push(`最终 PR：${input.task.prUrl}`);
    if (input.task.commitShas.length > 0) {
      details.push(`Commit：${input.task.commitShas.join(', ')}`);
    }
  }
  return details;
}

function buildExecStageDetails(
  input: {
    task: TaskItemRecord;
    thread: TaskThreadRecord;
    currentPlan: TaskPlanRevisionRecord | null;
    artifacts: TaskArtifactRecord[];
    agentStages: TaskAgentStageRecord[];
  },
  details: string[],
): void {
  const stage = getStageByAgentStage(input.agentStages, TASK_AGENT_STAGE.EXEC);
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
  if (steps) details.push(`实施步骤：${steps.artifactId}`);
  if (approved) details.push('实施步骤已人工确认');
  if (stage?.latestRun) details.push(`最近运行：${stage.latestRun.runId}`);
  if (input.task.worktreePath)
    details.push(`工作目录：${input.task.worktreePath}`);
}

function isStageBlockedByFailed(
  stageId: TaskFlowStageId,
  currentStageId: TaskFlowStageId,
  failedStage: TaskAgentStageRecord | undefined,
): boolean {
  if (stageId !== currentStageId || !failedStage) return false;
  return (
    (stageId === 'plan_discussion' &&
      failedStage.stage === TASK_AGENT_STAGE.PLANNING) ||
    (stageId === 'exec' && failedStage.stage === TASK_AGENT_STAGE.EXEC) ||
    (stageId === 'delivery' && failedStage.stage === TASK_AGENT_STAGE.DELIVERY)
  );
}

function getRunningAgentForStage(
  stageId: TaskFlowStageId,
  agentStages: TaskAgentStageRecord[],
): TaskAgentStageRecord | undefined {
  if (stageId === 'plan_discussion') {
    return getStageByAgentStage(agentStages, TASK_AGENT_STAGE.PLANNING);
  }
  if (stageId === 'exec')
    return getStageByAgentStage(agentStages, TASK_AGENT_STAGE.EXEC);
  if (stageId === 'delivery')
    return getStageByAgentStage(agentStages, TASK_AGENT_STAGE.DELIVERY);
  return undefined;
}

function checkAttentionState(
  stageId: TaskFlowStageId,
  currentStageId: TaskFlowStageId,
  agentStages: TaskAgentStageRecord[],
): boolean {
  if (stageId !== currentStageId) return false;
  const runningStage = getRunningAgentForStage(stageId, agentStages);
  return Boolean(
    runningStage?.status === AGENT_RUN_STATUS.RUNNING &&
      runningStage.latestRun &&
      isLongRunning(runningStage.latestRun),
  );
}

function computeStageState(input: {
  stageId: TaskFlowStageId;
  currentStageId: TaskFlowStageId;
  index: number;
  currentIndex: number;
  failedStage: TaskAgentStageRecord | undefined;
  agentStages: TaskAgentStageRecord[];
}): { state: TaskFlowStageState; blocker?: string } {
  const baseState: TaskFlowStageState =
    input.index < input.currentIndex
      ? 'completed'
      : input.index === input.currentIndex
        ? 'current'
        : 'pending';

  if (
    isStageBlockedByFailed(
      input.stageId,
      input.currentStageId,
      input.failedStage,
    )
  ) {
    const blocker = input.failedStage?.latestRun
      ? getAgentRunFailureSummary(input.failedStage.latestRun)
      : `${input.failedStage?.label}失败`;
    return { state: 'blocked', blocker };
  }

  if (
    checkAttentionState(input.stageId, input.currentStageId, input.agentStages)
  ) {
    return {
      state: 'attention',
      blocker: '运行时间超过 30 分钟，可能需要确认运行状态或人工接管。',
    };
  }
  return { state: baseState };
}

type StagesInput = {
  currentStageId: TaskFlowStageId;
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  plans: TaskPlanRevisionRecord[];
  artifacts: TaskArtifactRecord[];
  agentStages: TaskAgentStageRecord[];
};

function buildChatModeStages(input: StagesInput): TaskFlowStage[] {
  const state: TaskFlowStageState =
    input.thread.status === THREAD_STATUS.ANSWERED ? 'completed' : 'current';
  return [
    {
      id: 'chat',
      label: TASK_FLOW_STAGE_LABELS.chat,
      summary: getTaskFlowStageSummary({ stageId: 'chat', ...input }),
      state,
      details: buildTaskFlowStageDetails({ stageId: 'chat', ...input }),
      startedAt: input.task.createdAt,
      endedAt:
        input.thread.status === THREAD_STATUS.ANSWERED
          ? input.task.updatedAt
          : undefined,
    },
  ];
}

function buildRegularStages(input: StagesInput): TaskFlowStage[] {
  const currentIndex = TASK_FLOW_STAGE_ORDER.indexOf(input.currentStageId);
  const failedStage = isTaskCancelled(input.task)
    ? undefined
    : getLatestFailedAgentStage(input.agentStages);
  return TASK_FLOW_STAGE_ORDER.map((stageId, index) => {
    const { state, blocker } = computeStageState({
      stageId,
      currentStageId: input.currentStageId,
      index,
      currentIndex,
      failedStage,
      agentStages: input.agentStages,
    });
    return {
      id: stageId,
      label: TASK_FLOW_STAGE_LABELS[stageId],
      summary: getTaskFlowStageSummary({ stageId, ...input }),
      state,
      blocker,
      details: buildTaskFlowStageDetails({ stageId, ...input }),
      startedAt: stageId === 'requirements' ? input.task.createdAt : undefined,
      endedAt:
        state === 'completed'
          ? stageId === 'requirements'
            ? input.thread.createdAt
            : input.task.updatedAt
          : undefined,
    };
  });
}

export function buildTaskFlowStages(input: StagesInput): TaskFlowStage[] {
  if (input.task.currentWorkflowKind === WORKFLOW_KIND.PLAN) {
    return buildChatModeStages(input);
  }
  return buildRegularStages(input);
}
