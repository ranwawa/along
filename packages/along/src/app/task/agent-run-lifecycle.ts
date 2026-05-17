import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import {
  AGENT_RUN_STATUS,
  createTaskAgentRun,
  ensureTaskAgentBinding,
  finishTaskAgentRun,
  readTaskAgentRun,
  recordTaskAgentResult,
  TASK_AGENT_PROGRESS_PHASE,
  type TaskAgentBindingRecord,
  type TaskAgentRunRecord,
} from '../planning';
import {
  startTaskAgentProgressHeartbeat,
  type TaskAgentProgressContext,
  writeTaskAgentProgress,
} from './agent-progress';

export interface TaskAgentTurnInput {
  taskId: string;
  threadId: string;
  agentId: string;
  cwd: string;
  model?: string;
  personalityVersion?: string;
  inputArtifactIds?: string[];
  outputMetadata?: Record<string, unknown>;
}

export interface StartedTaskAgentRun {
  binding: TaskAgentBindingRecord;
  run: TaskAgentRunRecord;
  progressContext: TaskAgentProgressContext;
  usedResume: boolean;
}

type TaskAgentCancelHandler = (reason?: string) => void;

const runningTaskAgentCancels = new Map<string, TaskAgentCancelHandler>();

export function registerTaskAgentCancellation(
  runId: string,
  cancel: TaskAgentCancelHandler,
): () => void {
  runningTaskAgentCancels.set(runId, cancel);
  return () => {
    if (runningTaskAgentCancels.get(runId) === cancel) {
      runningTaskAgentCancels.delete(runId);
    }
  };
}

export function requestTaskAgentCancellation(
  runId: string,
  reason?: string,
): boolean {
  const cancel = runningTaskAgentCancels.get(runId);
  if (!cancel) return false;
  cancel(reason);
  return true;
}

export function isTaskAgentRunCancelled(runId: string): boolean {
  const runRes = readTaskAgentRun(runId);
  return runRes.success && runRes.data?.status === AGENT_RUN_STATUS.CANCELLED;
}

export function completeTaskAgentCancellation(
  context: TaskAgentProgressContext,
  summary = 'Agent 运行已中断。',
  detail?: string,
): Result<TaskAgentRunRecord> {
  if (isTaskAgentRunCancelled(context.runId)) {
    const runRes = readTaskAgentRun(context.runId);
    return runRes.success && runRes.data
      ? success(runRes.data)
      : failure('Agent Run 已取消，但读取状态失败');
  }
  writeTaskAgentProgress(
    context,
    TASK_AGENT_PROGRESS_PHASE.CANCELLED,
    summary,
    detail,
  );
  return finishTaskAgentRun({
    runId: context.runId,
    status: AGENT_RUN_STATUS.CANCELLED,
    error: detail,
  });
}

export function startTaskAgentRun(
  input: TaskAgentTurnInput,
  runtimeId: string,
): Result<StartedTaskAgentRun> {
  const bindingRes = ensureTaskAgentBinding({
    taskId: input.taskId,
    threadId: input.threadId,
    agentId: input.agentId,
    runtimeId,
    cwd: input.cwd,
    model: input.model,
    personalityVersion: input.personalityVersion,
  });
  if (!bindingRes.success) return bindingRes;
  return createStartedRun(input, runtimeId, bindingRes.data);
}

function createStartedRun(
  input: TaskAgentTurnInput,
  runtimeId: string,
  binding: TaskAgentBindingRecord,
): Result<StartedTaskAgentRun> {
  const runRes = createTaskAgentRun({
    taskId: input.taskId,
    threadId: input.threadId,
    agentId: input.agentId,
    runtimeId,
    runtimeSessionIdAtStart: binding.runtimeSessionId,
    inputArtifactIds: input.inputArtifactIds,
  });
  if (!runRes.success) return runRes;
  return success({
    binding,
    run: runRes.data,
    progressContext: {
      runId: runRes.data.runId,
      taskId: input.taskId,
      threadId: input.threadId,
      agentId: input.agentId,
      runtimeId,
    },
    usedResume: Boolean(binding.runtimeSessionId),
  });
}

export function startTaskAgentRunHeartbeat(
  context: TaskAgentProgressContext,
  summary: string,
  detail?: string,
): () => void {
  writeTaskAgentProgress(
    context,
    TASK_AGENT_PROGRESS_PHASE.STARTING,
    summary,
    detail,
  );
  return startTaskAgentProgressHeartbeat(context);
}

export function markTaskAgentFailed(
  context: TaskAgentProgressContext,
  error: string,
  runtimeSessionIdAtEnd?: string,
  summary = 'Agent 运行失败，正在记录错误。',
): Result<void> {
  if (isTaskAgentRunCancelled(context.runId)) return success(undefined);
  writeTaskAgentProgress(
    context,
    TASK_AGENT_PROGRESS_PHASE.FAILED,
    summary,
    error,
  );
  const failedRun = finishTaskAgentRun({
    runId: context.runId,
    status: AGENT_RUN_STATUS.FAILED,
    runtimeSessionIdAtEnd,
    error,
  });
  return failedRun.success ? success(undefined) : failure(failedRun.error);
}

export function saveTaskAgentOutput(
  input: TaskAgentTurnInput,
  runtimeId: string,
  assistantText: string,
  context: TaskAgentProgressContext,
  runtimeSessionIdAtEnd?: string,
): Result<string[]> {
  if (!assistantText) return success([]);
  if (isTaskAgentRunCancelled(context.runId)) {
    return failure('Agent Run 已取消，跳过保存输出');
  }
  writeTaskAgentProgress(
    context,
    TASK_AGENT_PROGRESS_PHASE.FINALIZING,
    '正在保存 Agent 输出。',
  );
  const artifactRes = recordTaskAgentResult({
    taskId: input.taskId,
    threadId: input.threadId,
    agentId: input.agentId,
    runtimeId,
    runId: context.runId,
    body: assistantText,
    metadata: input.outputMetadata,
  });
  if (artifactRes.success) return success([artifactRes.data.artifactId]);
  return failOutputSave(context, artifactRes.error, runtimeSessionIdAtEnd);
}

function failOutputSave(
  context: TaskAgentProgressContext,
  error: string,
  runtimeSessionIdAtEnd?: string,
): Result<string[]> {
  const failedRes = markTaskAgentFailed(
    context,
    error,
    runtimeSessionIdAtEnd,
    '保存 Agent 输出失败。',
  );
  return failedRes.success ? failure(error) : failure(failedRes.error);
}

export function finishTaskAgentSuccess(
  context: TaskAgentProgressContext,
  outputArtifactIds: string[],
  runtimeSessionIdAtEnd?: string,
): Result<TaskAgentRunRecord> {
  if (isTaskAgentRunCancelled(context.runId)) {
    const runRes = readTaskAgentRun(context.runId);
    return runRes.success && runRes.data
      ? success(runRes.data)
      : failure('Agent Run 已取消，但读取状态失败');
  }
  const finishedRun = finishTaskAgentRun({
    runId: context.runId,
    status: AGENT_RUN_STATUS.SUCCEEDED,
    runtimeSessionIdAtEnd,
    outputArtifactIds,
  });
  if (!finishedRun.success) return finishedRun;
  writeTaskAgentProgress(
    context,
    TASK_AGENT_PROGRESS_PHASE.COMPLETED,
    'Agent 运行完成，结果已记录。',
  );
  return finishedRun;
}
