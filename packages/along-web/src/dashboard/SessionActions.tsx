import type { DashboardSession } from '../types';
import { getIssueKey, isFailedStatus } from './sessionUtils';

export function SessionRowActions({
  session,
  restartingIssues,
  deletingIssues,
  onRestart,
  onDelete,
  compact = false,
}: {
  session: DashboardSession;
  restartingIssues: Set<string>;
  deletingIssues: Set<string>;
  onRestart: (session: DashboardSession, event?: React.MouseEvent) => void;
  onDelete: (session: DashboardSession, event?: React.MouseEvent) => void;
  compact?: boolean;
}) {
  const key = getIssueKey(session);
  const sizeClass = compact ? 'w-7 h-7' : 'w-8 h-8';

  return (
    <div className="flex gap-1.5 shrink-0">
      {isFailedStatus(session.lifecycle) && (
        <button
          type="button"
          className={`inline-flex items-center justify-center ${sizeClass} rounded-lg border border-transparent transition-all cursor-pointer ${
            restartingIssues.has(key)
              ? 'bg-blue-500/20 text-status-running animate-spin'
              : 'bg-white/5 text-text-secondary hover:bg-blue-500/20 hover:text-status-running'
          }`}
          title="重启此任务"
          onClick={(event) => onRestart(session, event)}
          disabled={restartingIssues.has(key)}
        >
          🔄
        </button>
      )}
      <button
        type="button"
        className={`inline-flex items-center justify-center ${sizeClass} rounded-lg border border-transparent transition-all cursor-pointer ${
          deletingIssues.has(key)
            ? 'bg-red-500/20 text-red-400 cursor-wait'
            : 'bg-white/5 text-text-secondary hover:bg-red-500/20 hover:text-red-300'
        }`}
        title="彻底删除此任务的本地数据"
        onClick={(event) => onDelete(session, event)}
        disabled={deletingIssues.has(key)}
      >
        🗑️
      </button>
    </div>
  );
}
