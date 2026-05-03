import type { DashboardSession } from '../types';
import { SessionRowActions } from './SessionActions';
import {
  getLifecycleLabel,
  getPhaseLabel,
  getProgressLabel,
  getStatusColor,
  getStepLabel,
} from './sessionUtils';

function IssueLinks({ session }: { session: DashboardSession }) {
  return (
    <>
      <a
        href={`https://github.com/${session.owner}/${session.repo}/issues/${session.issueNumber}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="text-inherit hover:underline"
      >
        #{session.issueNumber}
      </a>
      {session.context?.prNumber && session.context?.prUrl && (
        <a
          href={session.context.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="ml-1 text-inherit hover:underline"
        >
          PR #{session.context.prNumber}
        </a>
      )}
      {session.hasWorktree && (
        <span className="ml-1 opacity-70" title="Worktree exists">
          📁
        </span>
      )}
    </>
  );
}

function StatusLine({ session }: { session: DashboardSession }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize border ${getStatusColor(
          session.lifecycle,
        )}`}
      >
        {getLifecycleLabel(session.lifecycle)}
      </span>
      <span className="text-text-muted text-xs truncate">
        {getPhaseLabel(session.phase)} / {getStepLabel(session.step)}
      </span>
      {getProgressLabel(session) && (
        <span className="text-text-muted text-xs truncate">
          {getProgressLabel(session)}
        </span>
      )}
    </div>
  );
}

function MobileSessionList({
  sessions,
  restartingIssues,
  deletingIssues,
  onSelect,
  onRestart,
  onDelete,
}: SessionListProps) {
  return (
    <div className="lg:hidden flex flex-col">
      {sessions.length === 0 && (
        <div className="text-center text-text-muted px-4 py-8">
          No tasks found.
        </div>
      )}
      {sessions.map((session) => (
        <div
          key={`m-${session.owner}-${session.repo}-${session.issueNumber}`}
          className="flex items-center gap-3 px-4 py-3 border-b border-white/5"
        >
          <button
            type="button"
            onClick={() => onSelect(session)}
            className="flex flex-1 min-w-0 items-center gap-3 text-left cursor-pointer hover:bg-white/5 transition-colors rounded-lg"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-text-secondary text-sm">
                  {session.owner}/{session.repo}
                </span>
                <span className="text-sm">
                  <IssueLinks session={session} />
                </span>
              </div>
              {session.title && (
                <div className="text-sm truncate mb-1">{session.title}</div>
              )}
              <StatusLine session={session} />
            </div>
          </button>
          <SessionRowActions
            compact
            session={session}
            restartingIssues={restartingIssues}
            deletingIssues={deletingIssues}
            onRestart={onRestart}
            onDelete={onDelete}
          />
        </div>
      ))}
    </div>
  );
}

function DesktopSessionTable({
  sessions,
  restartingIssues,
  deletingIssues,
  onSelect,
  onRestart,
  onDelete,
}: SessionListProps) {
  return (
    <table className="hidden lg:table w-full border-collapse text-left">
      <thead>
        <tr>
          {['Issue', 'Title', 'Status', 'Action'].map((title) => (
            <th
              key={title}
              className="sticky top-0 bg-bg-secondary px-6 py-4 text-sm font-medium text-text-secondary border-b border-border-color z-10"
            >
              {title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sessions.length === 0 && (
          <tr>
            <td colSpan={4} className="text-center text-text-muted px-6 py-4">
              No tasks found.
            </td>
          </tr>
        )}
        {sessions.map((session) => (
          <tr
            key={`${session.owner}-${session.repo}-${session.issueNumber}`}
            onClick={() => onSelect(session)}
            className="transition-colors cursor-pointer hover:bg-white/5"
          >
            <td className="px-6 py-4 border-b border-white/5 text-sm">
              <span className="text-text-secondary">
                {session.owner}/{session.repo}
              </span>
              <span className="ml-2">
                <IssueLinks session={session} />
              </span>
            </td>
            <td
              className="px-6 py-4 border-b border-white/5 text-sm max-w-[300px] whitespace-nowrap overflow-hidden text-ellipsis"
              title={session.title || ''}
            >
              {session.title || '-'}
            </td>
            <td className="px-6 py-4 border-b border-white/5 text-sm">
              <StatusLine session={session} />
            </td>
            <td className="px-6 py-4 border-b border-white/5 text-sm">
              <SessionRowActions
                session={session}
                restartingIssues={restartingIssues}
                deletingIssues={deletingIssues}
                onRestart={onRestart}
                onDelete={onDelete}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface SessionListProps {
  sessions: DashboardSession[];
  restartingIssues: Set<string>;
  deletingIssues: Set<string>;
  onSelect: (session: DashboardSession) => void;
  onRestart: (session: DashboardSession, event?: React.MouseEvent) => void;
  onDelete: (session: DashboardSession, event?: React.MouseEvent) => void;
}

export function SessionList(props: SessionListProps) {
  return (
    <div className="flex-1 overflow-auto">
      <MobileSessionList {...props} />
      <DesktopSessionTable {...props} />
    </div>
  );
}
