import {
  recordTaskAgentProgress,
  TASK_AGENT_PROGRESS_PHASE,
  type TaskAgentProgressPhase,
} from './task-planning';

export interface TaskAgentProgressContext {
  runId: string;
  taskId: string;
  threadId: string;
  agentId: string;
  provider: string;
}

export function writeTaskAgentProgress(
  context: TaskAgentProgressContext,
  phase: TaskAgentProgressPhase,
  summary: string,
  detail?: string,
): void {
  recordTaskAgentProgress({
    ...context,
    phase,
    summary,
    detail,
  });
}

export function startTaskAgentProgressHeartbeat(
  context: TaskAgentProgressContext,
): () => void {
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const minutes = Math.max(1, Math.round((Date.now() - startedAt) / 60_000));
    writeTaskAgentProgress(
      context,
      TASK_AGENT_PROGRESS_PHASE.WAITING,
      `Agent 仍在执行，已运行约 ${minutes} 分钟。`,
      '系统未收到新的阶段事件，任务仍保持运行状态。',
    );
  }, 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
