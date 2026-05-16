import {
  TASK_AGENT_STAGE,
  type TaskAgentStageRecord,
  type TaskFlowAction,
  type TaskFlowActionId,
  THREAD_STATUS,
} from './task-planning';
import {
  buildRetryFailedStageAction,
  buildTaskFlowAction,
} from './task-planning-flow-actions';
import {
  buildDeliveryActions,
  computeExecActionFlags,
  type ExecActionFlags,
  type ExecInput,
} from './task-planning-flow-exec-flags';
import { isPlanningActive, isTaskExecing } from './task-planning-flow-status';

function buildSubmitFeedbackAction(
  input: ExecInput,
  canSubmitFeedback: boolean,
): TaskFlowAction {
  return buildTaskFlowAction({
    id: 'submit_feedback',
    label: input.openRound ? '补充当前反馈' : '继续讨论',
    description: input.openRound
      ? `反馈会进入当前轮次 ${input.openRound.roundId}`
      : '补充需求、提问或说明验收后的修改要求',
    enabled: canSubmitFeedback,
    disabledReason: '当前已进入实现链路，不能再直接修改计划讨论',
    stage: 'plan_discussion',
    variant: 'secondary',
  });
}

function buildApprovePlanAction(
  input: ExecInput,
  canApprove: boolean,
): TaskFlowAction {
  return buildTaskFlowAction({
    id: 'approve_plan',
    label: '批准计划',
    description: '确认当前计划并进入实现准备',
    enabled: canApprove,
    disabledReason: input.openRound
      ? '当前仍有开放反馈轮次'
      : input.currentPlan
        ? '计划已经批准'
        : '当前还没有可批准的计划',
    stage: 'plan_confirmation',
    variant: 'primary',
  });
}

function buildRequestRevisionAction(input: ExecInput): TaskFlowAction {
  return buildTaskFlowAction({
    id: 'request_revision',
    label: '要求修订',
    description: '提交反馈并要求 Planner 产出新版计划',
    enabled: Boolean(
      input.currentPlan && input.thread.status !== THREAD_STATUS.APPROVED,
    ),
    disabledReason: input.currentPlan
      ? '计划已批准，不能在此阶段要求修订'
      : '当前还没有可修订的计划',
    stage: 'plan_confirmation',
    variant: 'secondary',
  });
}

function buildRerunPlannerAction(
  input: ExecInput,
  failedStage: TaskAgentStageRecord | undefined,
): TaskFlowAction {
  return buildTaskFlowAction({
    id: 'rerun_planner',
    label: '重新规划',
    description: '重新调度 Planner 处理当前上下文',
    enabled: isPlanningActive(input),
    disabledReason: '当前不处于计划阶段',
    stage: 'plan_discussion',
    variant:
      failedStage?.stage === TASK_AGENT_STAGE.PLANNING ? 'danger' : 'secondary',
  });
}

function buildStartExecAction(
  input: ExecInput,
  canImplement: boolean,
  needsConfirmation: boolean,
  stepsApproved: boolean,
): TaskFlowAction {
  const execActionId: TaskFlowActionId = needsConfirmation
    ? 'confirm_exec_steps'
    : 'start_exec';
  return buildTaskFlowAction({
    id: execActionId,
    label: needsConfirmation
      ? '确认步骤并开始实现'
      : stepsApproved
        ? '开始实现'
        : '产出实施步骤',
    description: needsConfirmation
      ? '确认 Exec Agent 输出的实施步骤并开始编码'
      : stepsApproved
        ? '按已确认实施步骤启动 Exec Agent'
        : '先让 Exec Agent 产出详细实施步骤',
    enabled: canImplement,
    disabledReason: input.thread.approvedPlanId
      ? isTaskExecing(input)
        ? '实现 Agent 正在执行'
        : '当前 Task 状态不能开始实现'
      : '当前没有已批准计划',
    stage: 'exec',
    variant: 'primary',
  });
}

function buildFailedStageActions(
  failedStage: TaskAgentStageRecord | undefined,
  failedFlowStage: ExecActionFlags['failedFlowStage'],
  failedResumeReason: string | undefined,
): TaskFlowAction[] {
  return [
    buildRetryFailedStageAction(failedStage, failedFlowStage),
    buildTaskFlowAction({
      id: 'copy_resume_command',
      label: '复制接管命令',
      description: '复制失败阶段的本地接管命令',
      enabled: Boolean(failedStage?.manualResume?.command),
      disabledReason: failedResumeReason,
      stage: failedFlowStage,
      variant: 'secondary',
    }),
    buildTaskFlowAction({
      id: 'manual_complete',
      label: '人工已处理',
      description: '将失败阶段标记为已由人工处理',
      enabled: Boolean(failedStage),
      disabledReason: '当前没有失败阶段需要人工标记',
      stage: failedFlowStage,
      variant: 'primary',
    }),
  ];
}

export function buildExecModeActions(input: ExecInput): TaskFlowAction[] {
  const f = computeExecActionFlags(input);
  return [
    buildSubmitFeedbackAction(input, f.canSubmitFeedback),
    buildApprovePlanAction(input, f.canApprove),
    buildRequestRevisionAction(input),
    buildRerunPlannerAction(input, f.failedStage),
    buildStartExecAction(
      input,
      f.canImplement,
      f.needsConfirmation,
      f.execStepsApproved,
    ),
    ...buildFailedStageActions(
      f.failedStage,
      f.failedFlowStage,
      f.failedResumeReason,
    ),
    ...buildDeliveryActions(input, f.canDeliver),
  ];
}
