import {
  AGENT_RUN_STATUS,
  type TaskAgentManualResume,
  type TaskAgentProgressEventRecord,
  type TaskAgentRunRecord,
  type TaskAgentStageRecord,
  type TaskArtifactRecord,
  type TaskFeedbackRoundRecord,
  type TaskFlowSnapshot,
  type TaskItemRecord,
  type TaskPlanRevisionRecord,
  type TaskThreadRecord,
} from './';
import { buildTaskFlowActions, buildTaskFlowConclusion } from './flow-actions';
import { buildTaskFlowEvents } from './flow-events';
import { buildTaskFlowStages } from './flow-stage-builders';
import {
  getCurrentTaskFlowStageId,
  getLatestFailedAgentStage,
} from './flow-stages';
import { isTaskCancelled } from './flow-status';

export * from './flow-actions';
export * from './flow-events';
export * from './flow-exec-actions';
export * from './flow-exec-flags';
export * from './flow-stage-builders';
export * from './flow-stages';
export * from './flow-status';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildTaskFlowSnapshot(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  artifacts: TaskArtifactRecord[];
  plans: TaskPlanRevisionRecord[];
  agentRuns: TaskAgentRunRecord[];
  agentProgressEvents: TaskAgentProgressEventRecord[];
  agentStages: TaskAgentStageRecord[];
}): TaskFlowSnapshot {
  const currentStageId = getCurrentTaskFlowStageId(input);
  const isClosed = isTaskCancelled(input.task);
  const failedStage = isClosed
    ? undefined
    : getLatestFailedAgentStage(input.agentStages);
  const runningStage = isClosed
    ? undefined
    : input.agentStages.find(
        (stage) => stage.status === AGENT_RUN_STATUS.RUNNING,
      );
  const conclusion = buildTaskFlowConclusion({
    failedStage,
    runningStage,
    ...input,
  });
  const stages = buildTaskFlowStages({ currentStageId, ...input });
  const blockers = stages
    .map((stage) => stage.blocker)
    .filter((blocker): blocker is string => Boolean(blocker));

  if (!input.task.cwd && !input.task.worktreePath) {
    blockers.push('缺少工作目录，Agent 调度或人工接管可能无法定位仓库。');
  }
  if (!isClosed && failedStage?.manualResume?.reason) {
    blockers.push(failedStage.manualResume.reason);
  }

  return {
    currentStageId,
    conclusion: conclusion.conclusion,
    severity: conclusion.severity,
    stages,
    actions: buildTaskFlowActions(input),
    blockers: [...new Set(blockers)],
    events: buildTaskFlowEvents(input),
  };
}

export function buildManualResume(
  runtimeId?: string,
  cwd?: string,
  sessionId?: string,
): TaskAgentManualResume {
  if (!cwd) {
    return { available: false, reason: '缺少可接管的工作目录' };
  }

  const cdCommand = `cd ${shellQuote(cwd)}`;
  if (runtimeId === 'codex') {
    return sessionId
      ? {
          available: true,
          cwd,
          sessionId,
          command: `${cdCommand}\ncodex resume ${shellQuote(sessionId)}`,
        }
      : {
          available: true,
          cwd,
          command: `${cdCommand}\ncodex`,
          reason: '未记录 Codex 会话 ID，只能从工作目录手动接管',
        };
  }

  return {
    available: false,
    cwd,
    command: cdCommand,
    reason: runtimeId
      ? `仅支持 Codex 会话恢复，当前 runtime 为 ${runtimeId}`
      : '暂无可恢复的 Codex 会话',
  };
}
