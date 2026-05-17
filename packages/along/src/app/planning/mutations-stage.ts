import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import { createTaskAgentRun } from './agent-run';
import { finishTaskAgentRun } from './agent-run-events';
import { isTaskDelivered, isTaskDelivering } from './flow';
import type { CompleteTaskAgentStageManuallyInput } from './inputs';
import { recordTaskAgentResult } from './mutations-agent';
import {
  transitionTaskWorkflow,
  updateTaskDelivery,
} from './mutations-workflow';
import { readTaskPlanningSnapshot } from './read';
import type { TaskPlanningSnapshot } from './records';
import {
  AGENT_RUN_STATUS,
  LIFECYCLE,
  TASK_AGENT_ID,
  TASK_AGENT_STAGE,
} from './types';

const STAGE_DEFINITIONS: Record<string, { agentId: string; label: string }> = {
  planning: { agentId: TASK_AGENT_ID.PLANNING, label: '计划阶段' },
  exec: { agentId: TASK_AGENT_ID.EXEC, label: '实现阶段' },
  delivery: { agentId: TASK_AGENT_ID.DELIVERY, label: '交付阶段' },
};

function failManualStageRun(runId: string, error: string): Result<never> {
  const finishRes = finishTaskAgentRun({
    runId,
    status: AGENT_RUN_STATUS.FAILED,
    error,
  });
  return finishRes.success ? failure(error) : failure(finishRes.error);
}

function parseTaskPrNumber(prUrl: string): number | undefined {
  const match = prUrl.match(/\/pull\/(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function resolveManualStageStatus(
  input: CompleteTaskAgentStageManuallyInput,
  snapshot: TaskPlanningSnapshot,
): Result<void> {
  if (input.stage === TASK_AGENT_STAGE.EXEC) {
    return isTaskDelivering({ task: snapshot.task, thread: snapshot.thread }) ||
      isTaskDelivered(snapshot.task)
      ? success(undefined)
      : transitionTaskWorkflow({
          taskId: input.taskId,
          event: { type: 'exec.completed' },
        });
  }
  if (input.stage === TASK_AGENT_STAGE.DELIVERY && input.prUrl) {
    const deliveryRes = updateTaskDelivery({
      taskId: input.taskId,
      prUrl: input.prUrl,
      prNumber: input.prNumber || parseTaskPrNumber(input.prUrl),
    });
    return deliveryRes.success
      ? transitionTaskWorkflow({
          taskId: input.taskId,
          event: { type: 'exec.verified' },
        })
      : deliveryRes;
  }
  return success(undefined);
}

function recordAndFinishManualRun(
  input: CompleteTaskAgentStageManuallyInput,
  snapshot: TaskPlanningSnapshot,
  stageDef: { agentId: string; label: string },
  runId: string,
): Result<TaskPlanningSnapshot> {
  const body = [
    `${stageDef.label}已由人工接管处理。`,
    input.message ? `说明：${input.message.trim()}` : '',
    input.prUrl ? `PR：${input.prUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const artifactRes = recordTaskAgentResult({
    taskId: input.taskId,
    threadId: snapshot.thread.threadId,
    agentId: stageDef.agentId,
    runtimeId: 'manual',
    runId,
    body,
  });
  if (!artifactRes.success) return failManualStageRun(runId, artifactRes.error);
  const finishRes = finishTaskAgentRun({
    runId,
    status: AGENT_RUN_STATUS.SUCCEEDED,
    outputArtifactIds: [artifactRes.data.artifactId],
  });
  if (!finishRes.success) return finishRes;
  const refreshedRes = readTaskPlanningSnapshot(input.taskId);
  if (!refreshedRes.success) return refreshedRes;
  return refreshedRes.data
    ? success(refreshedRes.data)
    : failure(`Task ${input.taskId} 人工处理后读取快照失败`);
}

function runManualStage(
  input: CompleteTaskAgentStageManuallyInput,
  snapshot: TaskPlanningSnapshot,
  stageDef: { agentId: string; label: string },
): Result<TaskPlanningSnapshot> {
  const runRes = createTaskAgentRun({
    taskId: input.taskId,
    threadId: snapshot.thread.threadId,
    agentId: stageDef.agentId,
    runtimeId: 'manual',
    inputArtifactIds: snapshot.artifacts.map((a) => a.artifactId),
  });
  if (!runRes.success) return runRes;
  const run = runRes.data;

  const statusRes = resolveManualStageStatus(input, snapshot);
  if (!statusRes.success) return failManualStageRun(run.runId, statusRes.error);

  return recordAndFinishManualRun(input, snapshot, stageDef, run.runId);
}

export function completeTaskAgentStageManually(
  input: CompleteTaskAgentStageManuallyInput,
): Result<TaskPlanningSnapshot> {
  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${input.taskId}`);
  if (snapshot.task.lifecycle === LIFECYCLE.DONE)
    return failure('Task 已关闭，不能人工标记阶段完成');

  const stageDef = STAGE_DEFINITIONS[input.stage];
  if (!stageDef) return failure(`未知 Agent 阶段: ${input.stage}`);
  return runManualStage(input, snapshot, stageDef);
}
