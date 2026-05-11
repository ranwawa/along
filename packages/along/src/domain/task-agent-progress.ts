import {
  recordTaskAgentProgress,
  recordTaskAgentSessionEvent,
  TASK_AGENT_PROGRESS_PHASE,
  type TaskAgentProgressPhase,
  type TaskAgentSessionEventKind,
  type TaskAgentSessionEventSource,
} from './task-planning';

const MIN_RUNNING_MINUTES = 1;
const MILLISECONDS_PER_MINUTE = 60_000;
const HEARTBEAT_INTERVAL_MS = MILLISECONDS_PER_MINUTE;

export interface TaskAgentProgressContext {
  runId: string;
  taskId: string;
  threadId: string;
  agentId: string;
  runtimeId: string;
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
    const minutes = Math.max(
      MIN_RUNNING_MINUTES,
      Math.round((Date.now() - startedAt) / MILLISECONDS_PER_MINUTE),
    );
    writeTaskAgentProgress(
      context,
      TASK_AGENT_PROGRESS_PHASE.WAITING,
      `Agent 仍在执行，已运行约 ${minutes} 分钟。`,
      '系统未收到新的阶段事件，任务仍保持运行状态。',
    );
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
