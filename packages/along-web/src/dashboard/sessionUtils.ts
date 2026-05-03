import type { DashboardSession, StatusCounts } from '../types';

export const statusFilters = [
  'all',
  'running',
  'waiting_human',
  'waiting_external',
  'completed',
  'failed',
  'interrupted',
  'zombie',
] as const;

export type StatusFilter = (typeof statusFilters)[number];

export function isFailedStatus(lifecycle: string): boolean {
  return ['failed', 'interrupted', 'zombie'].includes(lifecycle);
}

export function getIssueKey(session: DashboardSession): string {
  return `${session.owner}/${session.repo}#${session.issueNumber}`;
}

export function getLifecycleLabel(lifecycle: string): string {
  switch (lifecycle) {
    case 'running':
      return 'Running';
    case 'waiting_human':
      return 'Waiting Human';
    case 'waiting_external':
      return 'Waiting External';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'interrupted':
      return 'Interrupted';
    case 'zombie':
      return 'Zombie';
    default:
      return lifecycle;
  }
}

export function getPhaseLabel(phase?: string): string {
  switch (phase) {
    case 'planning':
      return 'Planning';
    case 'implementation':
      return 'Implementation';
    case 'delivery':
      return 'Delivery';
    case 'stabilization':
      return 'Stabilization';
    case 'done':
      return 'Done';
    default:
      return phase || 'Unknown';
  }
}

export function getStepLabel(step?: string): string {
  if (!step) return 'Unknown';
  return step
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getProgressLabel(session: DashboardSession): string | null {
  if (!session.progress?.total) return null;
  return `${session.progress.current ?? 0}/${session.progress.total} ${
    session.progress.unit || ''
  }`.trim();
}

export function getBranchName(session: DashboardSession): string {
  return session.context?.branchName || '-';
}

export function getStatusColor(lifecycle: string): string {
  switch (lifecycle) {
    case 'running':
      return 'bg-sky-500/15 text-status-running border-sky-500/30';
    case 'waiting_human':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'waiting_external':
      return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
    case 'completed':
      return 'bg-emerald-500/15 text-status-completed border-emerald-500/30';
    case 'failed':
      return 'bg-red-500/15 text-status-error border-red-500/30';
    case 'interrupted':
      return 'bg-orange-500/15 text-status-crashed border-orange-500/30';
    case 'zombie':
      return 'bg-purple-500/15 text-status-zombie border-purple-500/30';
    default:
      return 'bg-gray-500/15 text-gray-300 border-gray-500/30';
  }
}

export function countSessions(sessions: DashboardSession[]): StatusCounts {
  const counts: StatusCounts = {
    running: 0,
    waiting_human: 0,
    waiting_external: 0,
    completed: 0,
    failed: 0,
    interrupted: 0,
    zombie: 0,
    total: sessions.length,
  };
  for (const session of sessions) counts[session.lifecycle] += 1;
  return counts;
}
