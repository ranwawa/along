import type { TaskFlowAction, TaskFlowStageState } from '../types';

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
      return 'bg-cyan-300 shadow-[0_0_0_4px_rgba(34,211,238,0.12)]';
    case 'blocked':
      return 'bg-rose-300 shadow-[0_0_0_4px_rgba(251,113,133,0.12)]';
    case 'attention':
      return 'bg-amber-300 shadow-[0_0_0_4px_rgba(251,191,36,0.12)]';
    default:
      return 'bg-zinc-600';
  }
}

export function getFlowActionClass(action: TaskFlowAction): string {
  if (!action.enabled) return 'border-border-color text-text-muted bg-black/20';
  if (action.variant === 'danger') {
    return 'border-rose-500/40 text-rose-100 bg-rose-500/10 hover:bg-rose-500/20';
  }
  if (action.variant === 'primary') {
    return 'border-brand bg-brand text-white hover:bg-brand-hover';
  }
  return 'border-border-color text-text-secondary hover:bg-white/5';
}
