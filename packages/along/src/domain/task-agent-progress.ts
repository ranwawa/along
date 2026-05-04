import {
  recordTaskAgentProgress,
  recordTaskAgentSessionEvent,
  TASK_AGENT_PROGRESS_PHASE,
  type TaskAgentProgressPhase,
  type TaskAgentSessionEventKind,
  type TaskAgentSessionEventSource,
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
  recordTaskAgentSessionEvent({
    ...context,
    source: 'system',
    kind: phase === TASK_AGENT_PROGRESS_PHASE.FAILED ? 'error' : 'progress',
    content: detail ? `${summary}\n${detail}` : summary,
    metadata: { phase },
  });
}

export function writeTaskAgentSessionEvent(
  context: TaskAgentProgressContext,
  source: TaskAgentSessionEventSource,
  kind: TaskAgentSessionEventKind,
  content: string,
  metadata?: Record<string, unknown>,
): void {
  recordTaskAgentSessionEvent({
    ...context,
    source,
    kind,
    content,
    metadata,
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
