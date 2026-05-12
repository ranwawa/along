// biome-ignore-all lint/style/noJsxLiterals: dashboard action buttons use compact symbols.
import { Button } from '../components/ui/button';
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
  const sizeClass = compact ? 'h-7 w-7' : 'h-8 w-8';

  return (
    <div className="flex gap-1.5 shrink-0">
      {isFailedStatus(session.lifecycle) && (
        <Button
          type="button"
          variant="softPrimary"
          size="icon"
          className={`${sizeClass} ${restartingIssues.has(key) ? 'animate-spin' : ''}`}
          title="重启此任务"
          onClick={(event) => onRestart(session, event)}
          disabled={restartingIssues.has(key)}
        >
          🔄
        </Button>
      )}
      <Button
        type="button"
        variant="softDanger"
        size="icon"
        className={sizeClass}
        title="彻底删除此任务的本地数据"
        onClick={(event) => onDelete(session, event)}
        disabled={deletingIssues.has(key)}
      >
        🗑️
      </Button>
    </div>
  );
}
