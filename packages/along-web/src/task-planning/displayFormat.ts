import type { TaskDisplayState } from '../types';

export function getTaskDisplayClass(state: TaskDisplayState): string {
  switch (state) {
    case 'ask_active':
      return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
    case 'ask_answered':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'waiting_user':
    case 'planning_awaiting_approval':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'planning_drafting':
      return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
    case 'planning_feedback':
    case 'implementation_verifying':
      return 'bg-violet-500/15 text-violet-300 border-violet-500/30';
    case 'planning_planned':
      return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
    case 'implementation_implementing':
      return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
    case 'completed':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'failed':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    case 'cancelled':
      return 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30';
    default:
      return 'bg-white/10 text-text-secondary border-border-color';
  }
}
