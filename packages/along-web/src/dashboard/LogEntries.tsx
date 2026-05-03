import type { UnifiedLogEntry } from '../types';

function getLogLevelColor(level: string): string {
  if (level === 'info') return 'text-status-running';
  if (level === 'error') return 'text-status-error';
  if (level === 'warn') return 'text-status-crashed';
  if (level === 'success') return 'text-status-completed';
  return '';
}

function getCategoryColor(category: string): string {
  switch (category) {
    case 'lifecycle':
      return 'text-sky-300';
    case 'conversation':
      return 'text-amber-300';
    case 'diagnostic':
      return 'text-red-300';
    case 'webhook':
      return 'text-purple-300';
    case 'server':
      return 'text-emerald-300';
    default:
      return 'text-text-muted';
  }
}

export function LogEntries({
  entries,
  showCategory,
}: {
  entries: UnifiedLogEntry[];
  showCategory: boolean;
}) {
  if (entries.length === 0) {
    return <div className="p-4 text-text-muted">No logs yet.</div>;
  }

  return entries.map((entry) => (
    <div
      key={`${entry.timestamp}:${entry.category}:${entry.source}:${entry.level}:${entry.message}`}
      className="p-1.5 rounded break-all hover:bg-white/5 whitespace-pre-wrap"
    >
      <span className="text-text-muted mr-2">
        {new Intl.DateTimeFormat('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(new Date(entry.timestamp))}
      </span>
      <span
        className={`font-semibold mr-2 uppercase ${getLogLevelColor(entry.level)}`}
      >
        [{entry.level}]
      </span>
      {showCategory && (
        <span
          className={`font-semibold mr-2 ${getCategoryColor(entry.category)}`}
        >
          [{entry.category}]
        </span>
      )}
      <span className="text-text-muted mr-2">({entry.source})</span>
      <span>{entry.message}</span>
    </div>
  ));
}
