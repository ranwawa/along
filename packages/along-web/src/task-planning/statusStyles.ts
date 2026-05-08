import type {
  TaskAgentStageStatus,
  TaskDisplayState,
  TaskStatus,
} from '../types';

export const TASK_STATUS_COLOR_STYLES = {
  cyan: {
    badgeClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    dotClass:
      'bg-current text-cyan-400 ring-cyan-400/35 shadow-[0_0_10px_rgba(34,211,238,0.45)]',
  },
  emerald: {
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    dotClass:
      'bg-current text-emerald-400 ring-emerald-400/35 shadow-[0_0_10px_rgba(52,211,153,0.45)]',
  },
  amber: {
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    dotClass:
      'bg-current text-amber-400 ring-amber-400/35 shadow-[0_0_10px_rgba(251,191,36,0.45)]',
  },
  sky: {
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    dotClass:
      'bg-current text-sky-400 ring-sky-400/35 shadow-[0_0_10px_rgba(56,189,248,0.45)]',
  },
  violet: {
    badgeClass: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    dotClass:
      'bg-current text-violet-400 ring-violet-400/35 shadow-[0_0_10px_rgba(167,139,250,0.45)]',
  },
  blue: {
    badgeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    dotClass:
      'bg-current text-blue-400 ring-blue-400/35 shadow-[0_0_10px_rgba(96,165,250,0.45)]',
  },
  rose: {
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    dotClass:
      'bg-current text-rose-400 ring-rose-400/35 shadow-[0_0_10px_rgba(251,113,133,0.45)]',
  },
  zinc: {
    badgeClass: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
    dotClass:
      'bg-current text-zinc-400 ring-zinc-400/35 shadow-[0_0_10px_rgba(161,161,170,0.35)]',
  },
  teal: {
    badgeClass: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
    dotClass:
      'bg-current text-teal-400 ring-teal-400/35 shadow-[0_0_10px_rgba(45,212,191,0.45)]',
  },
  neutral: {
    badgeClass: 'bg-white/10 text-text-secondary border-border-color',
    dotClass:
      'bg-current text-text-muted ring-border-color shadow-[0_0_8px_rgba(255,255,255,0.18)]',
  },
  muted: {
    badgeClass: 'bg-white/5 text-text-muted border-border-color',
    dotClass:
      'bg-current text-text-muted ring-border-color shadow-[0_0_8px_rgba(255,255,255,0.14)]',
  },
} as const;

export type TaskStatusColor = keyof typeof TASK_STATUS_COLOR_STYLES;

export const TASK_DISPLAY_STATE_COLORS: Record<
  TaskDisplayState,
  TaskStatusColor
> = {
  ask_active: 'cyan',
  ask_answered: 'emerald',
  waiting_user: 'amber',
  planning_drafting: 'sky',
  planning_awaiting_approval: 'amber',
  planning_feedback: 'violet',
  planning_planned: 'blue',
  implementation_implementing: 'cyan',
  implementation_verifying: 'violet',
  completed: 'emerald',
  failed: 'rose',
  cancelled: 'zinc',
  processing: 'cyan',
};

export const TASK_LEGACY_STATUS_COLORS: Record<TaskStatus, TaskStatusColor> = {
  planning: 'sky',
  planning_approved: 'amber',
  implementing: 'cyan',
  implemented: 'blue',
  delivering: 'violet',
  delivered: 'teal',
  completed: 'emerald',
  closed: 'zinc',
};

export const TASK_AGENT_STAGE_STATUS_COLORS: Record<
  TaskAgentStageStatus,
  TaskStatusColor
> = {
  idle: 'muted',
  running: 'cyan',
  succeeded: 'emerald',
  failed: 'rose',
  cancelled: 'zinc',
};

export function getTaskStatusColorStyle(color: TaskStatusColor) {
  return TASK_STATUS_COLOR_STYLES[color];
}

export function getTaskDisplayStatusStyle(state: TaskDisplayState) {
  return getTaskStatusColorStyle(TASK_DISPLAY_STATE_COLORS[state]);
}

export function getTaskLegacyStatusStyle(status: TaskStatus) {
  return getTaskStatusColorStyle(TASK_LEGACY_STATUS_COLORS[status]);
}

export function getTaskAgentStageStatusStyle(status: TaskAgentStageStatus) {
  return getTaskStatusColorStyle(TASK_AGENT_STAGE_STATUS_COLORS[status]);
}
