import { EXEC_STEPS_APPROVAL_KIND } from '../task/exec-steps';
import {
  AGENT_RUN_STATUS,
  type AgentRunStatus,
  ARTIFACT_TYPE,
  TASK_WORKSPACE_MODE,
  type TaskAgentRunRecord,
  type TaskArtifactRecord,
  type TaskFlowEvent,
  type TaskFlowEventType,
  type TaskItemRecord,
  type TaskPlanRevisionRecord,
  type TaskThreadRecord,
  THREAD_PURPOSE,
} from './';
import { getAgentRunFailureSummary } from './flow-actions';
import { isTaskCompleted } from './flow-status';

const USER_FEEDBACK_SUMMARY_MAX = 120;

export function getAgentRunEndEventType(
  status: AgentRunStatus,
): Extract<
  TaskFlowEventType,
  'agent_run_failed' | 'agent_run_succeeded' | 'agent_run_cancelled'
> {
  if (status === AGENT_RUN_STATUS.FAILED) return 'agent_run_failed';
  if (status === AGENT_RUN_STATUS.CANCELLED) return 'agent_run_cancelled';
  return 'agent_run_succeeded';
}

export function getAgentRunEndEventTitle(run: TaskAgentRunRecord): string {
  if (run.status === AGENT_RUN_STATUS.FAILED) return `${run.agentId} 运行失败`;
  if (run.status === AGENT_RUN_STATUS.CANCELLED)
    return `${run.agentId} 运行已取消`;
  return `${run.agentId} 运行完成`;
}

function buildUserFeedbackEvent(
  artifact: TaskArtifactRecord,
  thread: TaskThreadRecord,
): TaskFlowEvent {
  return {
    eventId: artifact.artifactId,
    type: 'user_feedback',
    stage: thread.purpose === THREAD_PURPOSE.CHAT ? 'chat' : 'plan_discussion',
    title: '用户补充反馈',
    summary: artifact.body.slice(0, USER_FEEDBACK_SUMMARY_MAX),
    occurredAt: artifact.createdAt,
  };
}

function buildApprovalEvent(artifact: TaskArtifactRecord): TaskFlowEvent {
  if (artifact.metadata.kind === EXEC_STEPS_APPROVAL_KIND) {
    return {
      eventId: artifact.artifactId,
      type: 'exec_steps_approved',
      stage: 'exec',
      title: '实施步骤已确认',
      summary: artifact.body,
      occurredAt: artifact.createdAt,
    };
  }
  return {
    eventId: artifact.artifactId,
    type: 'plan_approved',
    stage: 'plan_confirmation',
    title: '计划已批准',
    summary: artifact.body,
    occurredAt: artifact.createdAt,
  };
}

function buildArtifactEvents(
  artifacts: TaskArtifactRecord[],
  thread: TaskThreadRecord,
): TaskFlowEvent[] {
  const events: TaskFlowEvent[] = [];
  for (const artifact of artifacts) {
    if (artifact.type === ARTIFACT_TYPE.USER_MESSAGE) {
      events.push(buildUserFeedbackEvent(artifact, thread));
    }
    if (artifact.type === ARTIFACT_TYPE.APPROVAL) {
      events.push(buildApprovalEvent(artifact));
    }
    if (artifact.type === ARTIFACT_TYPE.TASK_CLOSED) {
      events.push(buildTaskClosedEvent(artifact));
    }
  }
  return events;
}

function buildTaskClosedEvent(artifact: TaskArtifactRecord): TaskFlowEvent {
  const previousLifecycle =
    typeof artifact.metadata.previousLifecycle === 'string'
      ? artifact.metadata.previousLifecycle
      : undefined;
  const previousWorkflowKind =
    typeof artifact.metadata.previousWorkflowKind === 'string'
      ? artifact.metadata.previousWorkflowKind
      : undefined;
  const previousThreadStatus =
    typeof artifact.metadata.previousThreadStatus === 'string'
      ? artifact.metadata.previousThreadStatus
      : undefined;
  const reason =
    typeof artifact.metadata.reason === 'string'
      ? artifact.metadata.reason
      : undefined;
  return {
    eventId: artifact.artifactId,
    type: 'task_closed',
    stage: 'completed',
    title: '任务已关闭',
    summary: [
      previousLifecycle ? `关闭前生命周期：${previousLifecycle}` : '',
      previousWorkflowKind ? `工作流：${previousWorkflowKind}` : '',
      previousThreadStatus ? `线程：${previousThreadStatus}` : '',
      reason,
    ]
      .filter(Boolean)
      .join('；'),
    occurredAt: artifact.createdAt,
  };
}

function buildAgentRunEvents(agentRuns: TaskAgentRunRecord[]): TaskFlowEvent[] {
  const events: TaskFlowEvent[] = [];
  for (const run of agentRuns) {
    const stage =
      run.agentId === 'planner'
        ? 'plan_discussion'
        : run.agentId === 'delivery'
          ? 'delivery'
          : 'exec';
    events.push({
      eventId: `${run.runId}:start`,
      type: 'agent_run_started',
      stage,
      title: `${run.agentId} 开始运行`,
      summary: `${run.runtimeId} / ${run.runId}`,
      occurredAt: run.startedAt,
    });
    if (run.endedAt) {
      events.push({
        eventId: `${run.runId}:end`,
        type: getAgentRunEndEventType(run.status),
        stage,
        title: getAgentRunEndEventTitle(run),
        summary:
          run.status === AGENT_RUN_STATUS.FAILED
            ? getAgentRunFailureSummary(run)
            : run.status === AGENT_RUN_STATUS.CANCELLED
              ? run.error || '任务关闭时已取消运行'
              : undefined,
        occurredAt: run.endedAt,
      });
    }
  }
  return events;
}

function buildPlanRevisionEvents(
  plans: TaskPlanRevisionRecord[],
): TaskFlowEvent[] {
  return plans.map((plan) => ({
    eventId: plan.planId,
    type: 'plan_revision' as const,
    stage: 'plan_confirmation' as const,
    title: `计划 v${plan.version}`,
    summary: plan.status,
    occurredAt: plan.createdAt,
  }));
}

function buildDeliveryEvent(task: TaskItemRecord): TaskFlowEvent | null {
  if (!task.prUrl && task.workspaceMode !== TASK_WORKSPACE_MODE.DEFAULT_BRANCH)
    return null;
  return {
    eventId: `delivery:${task.taskId}`,
    type: 'delivery_updated',
    stage: 'delivery',
    title: '结果已交付',
    summary: task.prUrl || `已推送默认分支 ${task.branchName || ''}`.trim(),
    occurredAt: task.updatedAt,
  };
}

export function buildTaskFlowEvents(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  artifacts: TaskArtifactRecord[];
  plans: TaskPlanRevisionRecord[];
  agentRuns: TaskAgentRunRecord[];
}): TaskFlowEvent[] {
  const events: TaskFlowEvent[] = [
    {
      eventId: `task:${input.task.taskId}`,
      type: 'task_created',
      stage: 'requirements',
      title: '任务已创建',
      summary: input.task.title,
      occurredAt: input.task.createdAt,
    },
  ];

  events.push(...buildArtifactEvents(input.artifacts, input.thread));
  events.push(...buildPlanRevisionEvents(input.plans));
  events.push(...buildAgentRunEvents(input.agentRuns));

  const deliveryEvent = buildDeliveryEvent(input.task);
  if (deliveryEvent) events.push(deliveryEvent);

  if (isTaskCompleted(input.task)) {
    events.push({
      eventId: `completed:${input.task.taskId}`,
      type: 'task_completed',
      stage: 'completed',
      title: '任务已完成',
      occurredAt: input.task.updatedAt,
    });
  }

  return events.sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt),
  );
}
