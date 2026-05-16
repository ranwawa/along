import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import type { TaskAgentProgressContext } from './task-agent-progress';
import { writeTaskAgentProgress } from './task-agent-progress';
import {
  completeTaskAgentCancellation,
  finishTaskAgentSuccess,
  markTaskAgentFailed,
  saveTaskAgentOutput,
} from './task-agent-run-lifecycle';
import type {
  RunTaskCodexTurnInput,
  RunTaskCodexTurnOutput,
  TaskCodexTurn,
} from './task-codex-runner';
import {
  getCodexAssistantText,
  parseStructuredOutput,
} from './task-codex-utils';
import {
  TASK_AGENT_PROGRESS_PHASE,
  updateTaskAgentRuntimeSession,
} from './task-planning';

const RUNTIME_ID = 'codex';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function failCodexTurn(
  context: TaskAgentProgressContext,
  error: unknown,
  runtimeSessionIdAtEnd?: string,
): Result<never> {
  const message = getErrorMessage(error);
  if (runtimeSessionIdAtEnd) {
    updateTaskAgentRuntimeSession(
      context.threadId,
      context.agentId,
      RUNTIME_ID,
      runtimeSessionIdAtEnd,
    );
  }
  const failedRes = markTaskAgentFailed(
    context,
    message,
    runtimeSessionIdAtEnd,
  );
  return failedRes.success
    ? failure(`Codex Agent 执行失败: ${message}`)
    : failure(failedRes.error);
}

export function completeCancelledCodexTurn(
  context: TaskAgentProgressContext,
  usedResume: boolean,
  latestThreadId?: string,
): Result<RunTaskCodexTurnOutput> {
  const runRes = completeTaskAgentCancellation(
    context,
    'Codex Agent 运行已中断，跳过保存输出。',
  );
  if (!runRes.success) return runRes;
  return success({
    run: runRes.data,
    runtimeSessionId: latestThreadId,
    usedResume,
    assistantText: '',
    outputArtifactIds: [],
  });
}

export function completeCodexTurn(
  input: RunTaskCodexTurnInput,
  context: TaskAgentProgressContext,
  usedResume: boolean,
  turn: TaskCodexTurn,
  outputSchema: unknown,
  latestThreadId?: string,
): Result<RunTaskCodexTurnOutput> {
  const sessionRes = saveCodexSession(input, context, latestThreadId);
  if (!sessionRes.success) return sessionRes;
  const assistantText = getCodexAssistantText(turn);
  const structuredOutput = parseStructuredOutput(assistantText, outputSchema);
  const outputRes = saveTaskAgentOutput(
    input,
    RUNTIME_ID,
    assistantText,
    context,
    latestThreadId,
  );
  if (!outputRes.success) return outputRes;
  const finishedRun = finishTaskAgentSuccess(
    context,
    outputRes.data,
    latestThreadId,
  );
  if (!finishedRun.success) return finishedRun;
  return success({
    run: finishedRun.data,
    runtimeSessionId: latestThreadId,
    usedResume,
    assistantText,
    structuredOutput,
    outputArtifactIds: outputRes.data,
  });
}

function saveCodexSession(
  input: RunTaskCodexTurnInput,
  context: TaskAgentProgressContext,
  latestThreadId?: string,
): Result<void> {
  if (!latestThreadId) return success(undefined);
  writeTaskAgentProgress(
    context,
    TASK_AGENT_PROGRESS_PHASE.CONTEXT,
    '正在保存 Agent 会话标识。',
  );
  const updateRes = updateTaskAgentRuntimeSession(
    input.threadId,
    input.agentId,
    RUNTIME_ID,
    latestThreadId,
  );
  if (updateRes.success) return success(undefined);
  const failedRes = markTaskAgentFailed(
    context,
    updateRes.error,
    latestThreadId,
    '保存 Agent 会话标识失败。',
  );
  return failedRes.success ? failure(updateRes.error) : failedRes;
}
