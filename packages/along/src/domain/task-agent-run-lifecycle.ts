import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  startTaskAgentProgressHeartbeat,
  type TaskAgentProgressContext,
  writeTaskAgentProgress,
} from './task-agent-progress';
import {
  AGENT_RUN_STATUS,
  createTaskAgentRun,
  ensureTaskAgentBinding,
  finishTaskAgentRun,
  recordTaskAgentResult,
  TASK_AGENT_PROGRESS_PHASE,
  type TaskAgentBindingRecord,
  type TaskAgentRunRecord,
} from './task-planning';

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

export function startTaskAgentRun(
  input: TaskAgentTurnInput,
  provider: string,
): Result<StartedTaskAgentRun> {
  const bindingRes = ensureTaskAgentBinding({
    threadId: input.threadId,
    agentId: input.agentId,
    provider,
    cwd: input.cwd,
    model: input.model,
    personalityVersion: input.personalityVersion,
  });
  if (!bindingRes.success) return bindingRes;
  return createStartedRun(input, provider, bindingRes.data);
}

function createStartedRun(
  input: TaskAgentTurnInput,
  provider: string,
  binding: TaskAgentBindingRecord,
): Result<StartedTaskAgentRun> {
  const runRes = createTaskAgentRun({
    taskId: input.taskId,
    threadId: input.threadId,
    agentId: input.agentId,
    provider,
    providerSessionIdAtStart: binding.providerSessionId,
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
      provider,
    },
    usedResume: Boolean(binding.providerSessionId),
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
  providerSessionIdAtEnd?: string,
  summary = 'Agent 运行失败，正在记录错误。',
): Result<void> {
  writeTaskAgentProgress(
    context,
    TASK_AGENT_PROGRESS_PHASE.FAILED,
    summary,
    error,
  );
  const failedRun = finishTaskAgentRun({
    runId: context.runId,
    status: AGENT_RUN_STATUS.FAILED,
    providerSessionIdAtEnd,
    error,
  });
  return failedRun.success ? success(undefined) : failure(failedRun.error);
}

export function saveTaskAgentOutput(
  input: TaskAgentTurnInput,
  provider: string,
  assistantText: string,
  context: TaskAgentProgressContext,
  providerSessionIdAtEnd?: string,
): Result<string[]> {
  if (!assistantText) return success([]);
  writeTaskAgentProgress(
    context,
    TASK_AGENT_PROGRESS_PHASE.FINALIZING,
    '正在保存 Agent 输出。',
  );
  const artifactRes = recordTaskAgentResult({
    taskId: input.taskId,
    threadId: input.threadId,
    agentId: input.agentId,
    provider,
    runId: context.runId,
    body: assistantText,
    metadata: input.outputMetadata,
  });
  if (artifactRes.success) return success([artifactRes.data.artifactId]);
  return failOutputSave(context, artifactRes.error, providerSessionIdAtEnd);
}

function failOutputSave(
  context: TaskAgentProgressContext,
  error: string,
  providerSessionIdAtEnd?: string,
): Result<string[]> {
  const failedRes = markTaskAgentFailed(
    context,
    error,
    providerSessionIdAtEnd,
    '保存 Agent 输出失败。',
  );
  return failedRes.success ? failure(error) : failure(failedRes.error);
}

export function finishTaskAgentSuccess(
  context: TaskAgentProgressContext,
  outputArtifactIds: string[],
  providerSessionIdAtEnd?: string,
): Result<TaskAgentRunRecord> {
  const finishedRun = finishTaskAgentRun({
    runId: context.runId,
    status: AGENT_RUN_STATUS.SUCCEEDED,
    providerSessionIdAtEnd,
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
