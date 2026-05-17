import { iso_timestamp } from '../../core/common';
import { getDb } from '../../core/db';
import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import {
  createTaskAgentRun,
  recordTaskAgentProgress,
  recordTaskAgentSessionEvent,
} from './agent-run';
import { finishTaskAgentRun } from './agent-run-events';
import { insertArtifact } from './artifact';
import type {
  RecordTaskAgentResultInput,
  RecordTaskExecFailureInput,
} from './inputs';
import { transitionTaskWorkflow } from './mutations-workflow';
import { readTaskPlanningSnapshot } from './read';
import type { TaskArtifactRecord, TaskPlanningSnapshot } from './records';
import {
  AGENT_RUN_STATUS,
  ARTIFACT_ROLE,
  ARTIFACT_TYPE,
  LIFECYCLE,
  TASK_AGENT_PROGRESS_PHASE,
  TASK_AGENT_STAGE,
} from './types';

function ensureTaskIsOpen(
  snapshot: { task: { lifecycle: string } },
  action: string,
): Result<void> {
  return snapshot.task.lifecycle === LIFECYCLE.DONE
    ? failure(`Task 已关闭，不能${action}`)
    : success(undefined);
}

function ensureTaskCanRecordAgentResult(taskId: string): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  try {
    const row = dbRes.data
      .prepare('SELECT lifecycle FROM task_items WHERE task_id = ?')
      .get(taskId) as { lifecycle: string | null } | null;
    if (!row) return failure(`Task 不存在: ${taskId}`);
    if (row.lifecycle === LIFECYCLE.DONE)
      return failure('Task 已关闭，不能记录 Agent Result');
    return success(undefined);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`检查 Task 状态失败: ${message}`);
  }
}

export function recordTaskAgentResult(
  input: RecordTaskAgentResultInput,
): Result<TaskArtifactRecord> {
  const body = input.body.trim();
  if (!body) return failure('Agent Result 内容不能为空');
  const openRes = ensureTaskCanRecordAgentResult(input.taskId);
  if (!openRes.success) return openRes;
  try {
    const artifact = insertArtifact({
      taskId: input.taskId,
      threadId: input.threadId,
      type: ARTIFACT_TYPE.AGENT_RESULT,
      role: ARTIFACT_ROLE.AGENT,
      body,
      metadata: {
        agentId: input.agentId || 'agent',
        runtimeId: input.runtimeId || 'unknown',
        runId: input.runId,
        ...(input.metadata || {}),
      },
      createdAt: iso_timestamp(),
    });
    return success(artifact);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`记录 Agent Result 失败: ${message}`);
  }
}

function recordExecFailureProgress(
  input: RecordTaskExecFailureInput,
  snapshot: TaskPlanningSnapshot,
  agentId: string,
  runtimeId: string,
  runId: string,
  summary: string,
) {
  return recordTaskAgentProgress({
    runId,
    taskId: input.taskId,
    threadId: snapshot.thread.threadId,
    agentId,
    runtimeId,
    phase: TASK_AGENT_PROGRESS_PHASE.FAILED,
    summary,
    detail: input.error,
  });
}

function recordExecFailureSession(
  input: RecordTaskExecFailureInput,
  snapshot: TaskPlanningSnapshot,
  agentId: string,
  runtimeId: string,
  runId: string,
  summary: string,
) {
  return recordTaskAgentSessionEvent({
    runId,
    taskId: input.taskId,
    threadId: snapshot.thread.threadId,
    agentId,
    runtimeId,
    source: 'system',
    kind: 'error',
    content: `${summary}\n${input.error}`,
    metadata: { phase: TASK_AGENT_PROGRESS_PHASE.FAILED },
  });
}

function recordExecFailureEvents(
  input: RecordTaskExecFailureInput,
  snapshot: TaskPlanningSnapshot,
  agentId: string,
  runtimeId: string,
  runId: string,
): Result<TaskArtifactRecord> {
  const summary = '实现启动失败，任务未进入编码执行。';
  const progressRes = recordExecFailureProgress(
    input,
    snapshot,
    agentId,
    runtimeId,
    runId,
    summary,
  );
  if (!progressRes.success) return progressRes;
  const sessionRes = recordExecFailureSession(
    input,
    snapshot,
    agentId,
    runtimeId,
    runId,
    summary,
  );
  if (!sessionRes.success) return sessionRes;
  return recordTaskAgentResult({
    taskId: input.taskId,
    threadId: snapshot.thread.threadId,
    agentId,
    runtimeId,
    runId,
    body: `实现启动失败：${input.error}`,
    metadata: {
      kind: 'exec_failure',
      stage: TASK_AGENT_STAGE.EXEC,
      retryable: true,
    },
  });
}

function runExecFailureFlow(
  input: RecordTaskExecFailureInput,
  snapshot: TaskPlanningSnapshot,
  agentId: string,
  runtimeId: string,
): Result<void> {
  const runRes = createTaskAgentRun({
    taskId: input.taskId,
    threadId: snapshot.thread.threadId,
    agentId,
    runtimeId,
    inputArtifactIds: snapshot.artifacts.map((a) => a.artifactId),
  });
  if (!runRes.success) return runRes;
  const artifactRes = recordExecFailureEvents(
    input,
    snapshot,
    agentId,
    runtimeId,
    runRes.data.runId,
  );
  if (!artifactRes.success) return artifactRes;
  const finishRes = finishTaskAgentRun({
    runId: runRes.data.runId,
    status: AGENT_RUN_STATUS.FAILED,
    outputArtifactIds: [artifactRes.data.artifactId],
    error: input.error,
  });
  if (!finishRes.success) return finishRes;
  return transitionTaskWorkflow({
    taskId: input.taskId,
    event: { type: 'task.failed' },
  });
}

export function recordTaskExecFailure(
  input: RecordTaskExecFailureInput,
): Result<TaskPlanningSnapshot> {
  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${input.taskId}`);
  const openRes = ensureTaskIsOpen(snapshot, '记录实现失败');
  if (!openRes.success) return openRes;

  const agentId = input.agentId || 'implementer';
  const runtimeId = input.runtimeId || 'codex';
  const flowRes = runExecFailureFlow(input, snapshot, agentId, runtimeId);
  if (!flowRes.success) return flowRes;

  const refreshed = readTaskPlanningSnapshot(input.taskId);
  if (!refreshed.success) return refreshed;
  return refreshed.data
    ? success(refreshed.data)
    : failure(`Task ${input.taskId} 实现失败后读取快照失败`);
}
