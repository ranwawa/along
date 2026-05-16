import { areExecStepsApproved, findExecStepsArtifact } from './task-exec-steps';
import {
  AGENT_RUN_STATUS,
  TASK_AGENT_STAGE,
  type TaskAgentStageRecord,
  type TaskArtifactRecord,
  type TaskFeedbackRoundRecord,
  type TaskFlowAction,
  type TaskFlowStageId,
  type TaskItemRecord,
  type TaskPlanRevisionRecord,
  type TaskThreadRecord,
  THREAD_STATUS,
} from './task-planning';
import { buildTaskFlowAction } from './task-planning-flow-actions';
import {
  getCurrentTaskFlowStageId,
  getLatestFailedAgentStage,
  getStageByAgentStage,
} from './task-planning-flow-stages';
import {
  isPlanningApproved,
  isTaskCompleted,
  isTaskDelivered,
  isTaskImplemented,
} from './task-planning-flow-status';

export type ExecInput = {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  artifacts: TaskArtifactRecord[];
  agentStages: TaskAgentStageRecord[];
};

export type ExecActionFlags = {
  failedStage: TaskAgentStageRecord | undefined;
  failedFlowStage: TaskFlowStageId;
  failedResumeReason: string | undefined;
  canSubmitFeedback: boolean;
  canApprove: boolean;
  canImplement: boolean;
  needsConfirmation: boolean;
  execStepsApproved: boolean;
  canDeliver: boolean;
};

function computeFailedStageFlags(
  failedStage: TaskAgentStageRecord | undefined,
): Pick<
  ExecActionFlags,
  'failedStage' | 'failedFlowStage' | 'failedResumeReason'
> {
  return {
    failedStage,
    failedFlowStage:
      failedStage?.stage === TASK_AGENT_STAGE.PLANNING
        ? 'plan_discussion'
        : failedStage?.stage === TASK_AGENT_STAGE.DELIVERY
          ? 'delivery'
          : 'exec',
    failedResumeReason: failedStage?.manualResume?.command
      ? undefined
      : failedStage?.manualResume?.reason || '当前没有失败阶段可接管',
  };
}

function computeExecStepsFlags(
  input: ExecInput,
  execStage: TaskAgentStageRecord | undefined,
  deliveryStage: TaskAgentStageRecord | undefined,
): Pick<
  ExecActionFlags,
  'canImplement' | 'needsConfirmation' | 'execStepsApproved' | 'canDeliver'
> {
  const approvedPlan =
    input.currentPlan?.planId === input.thread.approvedPlanId
      ? input.currentPlan
      : null;
  const execSteps = approvedPlan
    ? findExecStepsArtifact(input, approvedPlan)
    : undefined;
  const execStepsApproved = approvedPlan
    ? areExecStepsApproved(input, approvedPlan)
    : false;
  return {
    canImplement: Boolean(
      input.thread.approvedPlanId &&
        isPlanningApproved(input) &&
        execStage?.status !== AGENT_RUN_STATUS.RUNNING,
    ),
    needsConfirmation: Boolean(execSteps && !execStepsApproved),
    execStepsApproved,
    canDeliver: Boolean(
      isTaskImplemented(input.task) &&
        deliveryStage?.status !== AGENT_RUN_STATUS.RUNNING,
    ),
  };
}

export function computeExecActionFlags(input: ExecInput): ExecActionFlags {
  const failedStage = getLatestFailedAgentStage(input.agentStages);
  const execStage = getStageByAgentStage(
    input.agentStages,
    TASK_AGENT_STAGE.EXEC,
  );
  const deliveryStage = getStageByAgentStage(
    input.agentStages,
    TASK_AGENT_STAGE.DELIVERY,
  );
  return {
    ...computeFailedStageFlags(failedStage),
    canSubmitFeedback:
      input.thread.status !== THREAD_STATUS.APPROVED ||
      isTaskDelivered(input.task) ||
      isTaskCompleted(input.task),
    canApprove: Boolean(
      input.currentPlan &&
        !input.openRound &&
        input.thread.status !== THREAD_STATUS.APPROVED,
    ),
    ...computeExecStepsFlags(input, execStage, deliveryStage),
  };
}

function buildStartDeliveryAction(
  input: ExecInput,
  canDeliver: boolean,
): TaskFlowAction {
  return buildTaskFlowAction({
    id: 'start_delivery',
    label: '提交并创建 PR',
    description: '将已实现结果提交到分支并创建 PR',
    enabled: canDeliver,
    disabledReason: isTaskImplemented(input.task)
      ? 'Delivery Agent 正在执行'
      : '只有实现完成后才能交付',
    stage: 'delivery',
    variant: 'primary',
  });
}

export function buildDeliveryActions(
  input: ExecInput,
  canDeliver: boolean,
): TaskFlowAction[] {
  return [
    buildStartDeliveryAction(input, canDeliver),
    buildTaskFlowAction({
      id: 'accept_delivery',
      label: '验收完成',
      description: '确认交付结果并结束任务',
      enabled: isTaskDelivered(input.task),
      disabledReason: '只有已交付任务可以验收完成',
      stage: 'delivery',
      variant: 'primary',
    }),
    buildTaskFlowAction({
      id: 'request_changes',
      label: '继续修改',
      description: '基于交付结果重新打开讨论',
      enabled: isTaskDelivered(input.task) || isTaskCompleted(input.task),
      disabledReason: '只有交付后才能发起继续修改',
      stage: 'delivery',
      variant: 'secondary',
    }),
    ...(isTaskCompleted(input.task)
      ? []
      : [
          buildTaskFlowAction({
            id: 'close_task',
            label: '关闭任务',
            description: '终止当前 Task 流程并保留历史记录',
            enabled: true,
            stage: getCurrentTaskFlowStageId(input),
            variant: 'danger',
          }),
        ]),
  ];
}
