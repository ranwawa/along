import type { DashboardSession, UnifiedLogEntry } from '../types';

export type LogTab = 'timeline' | 'lifecycle' | 'conversation' | 'diagnostic';

export function sessionParams(session: DashboardSession, file?: string) {
  const params = new URLSearchParams({
    owner: session.owner,
    repo: session.repo,
    issueNumber: String(session.issueNumber),
  });
  if (file) params.set('file', file);
  return params;
}

export function filterLogs(logs: UnifiedLogEntry[], tab: LogTab) {
  if (tab === 'timeline') return logs;
  if (tab === 'lifecycle') {
    return logs.filter((entry) => entry.category === 'lifecycle');
  }
  if (tab === 'diagnostic') {
    return logs.filter((entry) => entry.category === 'diagnostic');
  }
  return logs;
}
