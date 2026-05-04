import type {
  TaskAgentProgressPhase,
  TaskAgentStageRecord,
  TaskAgentStageStatus,
  TaskArtifactType,
  TaskFlowAction,
  TaskFlowSnapshot,
  TaskFlowStageState,
  TaskPlanningSnapshot,
  TaskStatus,
  TaskThreadStatus,
} from '../types';

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
  const totalSeconds = Math.max(1, Math.round((ended - started) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function getThreadStatusLabel(status: TaskThreadStatus): string {
  switch (status) {
    case 'drafting':
      return '起草中';
    case 'awaiting_approval':
      return '待批准';
    case 'discussing':
      return '讨论中';
    case 'approved':
      return '已批准';
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
    default:
      return status;
  }
}

export function getTaskStatusClass(status: TaskStatus): string {
  switch (status) {
    case 'planning':
      return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
    case 'planning_approved':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'implementing':
      return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
    case 'implemented':
      return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
    case 'delivering':
      return 'bg-violet-500/15 text-violet-300 border-violet-500/30';
    case 'delivered':
      return 'bg-teal-500/15 text-teal-300 border-teal-500/30';
    case 'completed':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    default:
      return 'bg-white/10 text-text-secondary border-border-color';
  }
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
    default:
      return status;
  }
}

export function getStageStatusClass(status: TaskAgentStageStatus): string {
  switch (status) {
    case 'running':
      return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
    case 'succeeded':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'failed':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    default:
      return 'bg-white/5 text-text-muted border-border-color';
  }
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

export function getArtifactLabel(type: TaskArtifactType): string {
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
      return 'Agent';
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
    default:
      return 'border-border-color bg-white/5';
  }
}

export function getFlowStageStateClass(state: TaskFlowStageState): string {
  switch (state) {
    case 'completed':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
    case 'current':
      return 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100';
    case 'blocked':
      return 'border-rose-500/40 bg-rose-500/10 text-rose-100';
    case 'attention':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-100';
    default:
      return 'border-border-color bg-black/20 text-text-muted';
  }
}

export function getFlowStageDotClass(state: TaskFlowStageState): string {
  switch (state) {
    case 'completed':
      return 'bg-emerald-400';
    case 'current':
      return 'bg-cyan-400';
    case 'blocked':
      return 'bg-rose-400';
    case 'attention':
      return 'bg-amber-400';
    default:
      return 'bg-text-muted';
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

export function getFlowActionClass(action: TaskFlowAction): string {
  if (action.variant === 'danger') {
    return 'border-rose-500/30 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25';
  }
  if (action.variant === 'primary') {
    return 'border-brand bg-brand text-white hover:bg-brand-hover';
  }
  return 'border-border-color text-text-secondary hover:bg-white/5';
}
