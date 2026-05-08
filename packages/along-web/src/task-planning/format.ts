import type {
  TaskAgentProgressPhase,
  TaskAgentStageRecord,
  TaskAgentStageStatus,
  TaskArtifactType,
  TaskFlowSnapshot,
  TaskPlanningSnapshot,
  TaskStatus,
  TaskThreadStatus,
} from '../types';
import {
  getTaskAgentStageStatusStyle,
  getTaskLegacyStatusStyle,
} from './statusStyles';

const MIN_DURATION_SECONDS = 1;
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

export function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDuration(startedAt: string, endedAt?: string): string {
  const started = new Date(startedAt).getTime();
  const ended = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (Number.isNaN(started) || Number.isNaN(ended) || ended < started) {
    return '-';
  }
  const totalSeconds = Math.max(
    MIN_DURATION_SECONDS,
    Math.round((ended - started) / MILLISECONDS_PER_SECOND),
  );
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function getThreadStatusLabel(status: TaskThreadStatus): string {
  switch (status) {
    case 'active':
      return '进行中';
    case 'waiting_user':
      return '待补充';
    case 'answered':
      return '已回答';
    case 'drafting':
      return '起草中';
    case 'awaiting_approval':
      return '待批准';
    case 'discussing':
      return '讨论中';
    case 'approved':
      return '已批准';
    case 'planned':
      return '已规划';
    case 'implementing':
      return '实现中';
    case 'verifying':
      return '验证中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    default:
      return status;
  }
}

export function getTaskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case 'planning':
      return '规划中';
    case 'planning_approved':
      return '方案已批准';
    case 'implementing':
      return '实现中';
    case 'implemented':
      return '已实现';
    case 'delivering':
      return '交付中';
    case 'delivered':
      return '已交付';
    case 'completed':
      return '已完成';
    case 'closed':
      return '已关闭';
    default:
      return status;
  }
}

export function getTaskStatusClass(status: TaskStatus): string {
  return getTaskLegacyStatusStyle(status).badgeClass;
}

export function getStageStatusLabel(status: TaskAgentStageStatus): string {
  switch (status) {
    case 'idle':
      return '未运行';
    case 'running':
      return '运行中';
    case 'succeeded':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
}

export function getStageStatusClass(status: TaskAgentStageStatus): string {
  return getTaskAgentStageStatusStyle(status).badgeClass;
}

export function getProgressPhaseLabel(phase: TaskAgentProgressPhase): string {
  switch (phase) {
    case 'starting':
      return '启动';
    case 'context':
      return '上下文';
    case 'tool':
      return '工具';
    case 'waiting':
      return '等待';
    case 'verifying':
      return '验证';
    case 'finalizing':
      return '整理';
    case 'completed':
      return '完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '取消';
    default:
      return phase;
  }
}

export function getProgressPhaseClass(phase: TaskAgentProgressPhase): string {
  switch (phase) {
    case 'completed':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
    case 'failed':
    case 'cancelled':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-200';
    case 'waiting':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    case 'tool':
    case 'verifying':
      return 'border-violet-500/30 bg-violet-500/10 text-violet-200';
    default:
      return 'border-cyan-500/25 bg-cyan-500/10 text-cyan-100';
  }
}

export function getLatestFailedStage(
  snapshot: TaskPlanningSnapshot,
): TaskAgentStageRecord | null {
  const failedStages = (snapshot.agentStages || []).filter(
    (stage) => stage.status === 'failed' && stage.latestRun,
  );
  return (
    failedStages.sort((left, right) =>
      (
        right.latestRun?.endedAt ||
        right.latestRun?.startedAt ||
        ''
      ).localeCompare(
        left.latestRun?.endedAt || left.latestRun?.startedAt || '',
      ),
    )[0] || null
  );
}

export function getArtifactLabel(
  type: TaskArtifactType,
  metadata: Record<string, unknown> = {},
): string {
  switch (type) {
    case 'user_message':
      return '用户';
    case 'plan_revision':
      return '计划';
    case 'planning_update':
      return '更新';
    case 'approval':
      return '批准';
    case 'agent_result':
      switch (metadata.kind) {
        case 'implementation_steps':
          return '实施步骤';
        case 'auto_commit':
          return '自动提交';
        case 'delivery':
          return '交付结果';
        default:
          return 'Agent 结果';
      }
    case 'task_closed':
      return '关闭';
    default:
      return type;
  }
}

export function getArtifactClass(type: TaskArtifactType): string {
  switch (type) {
    case 'user_message':
      return 'border-emerald-500/20 bg-emerald-500/10';
    case 'plan_revision':
      return 'border-amber-500/20 bg-amber-500/10';
    case 'planning_update':
      return 'border-cyan-500/20 bg-cyan-500/10';
    case 'approval':
      return 'border-emerald-500/25 bg-emerald-500/15';
    case 'agent_result':
      return 'border-white/10 bg-white/5';
    case 'task_closed':
      return 'border-zinc-500/25 bg-zinc-500/10';
    default:
      return 'border-border-color bg-white/5';
  }
}

export function getFlowSeverityClass(
  severity: TaskFlowSnapshot['severity'],
): string {
  switch (severity) {
    case 'success':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100';
    case 'warning':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-100';
    case 'blocked':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-100';
    default:
      return 'border-cyan-500/25 bg-cyan-500/10 text-cyan-100';
  }
}
