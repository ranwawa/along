import type { DashboardSession, SessionDiagnostic } from '../types';
import {
  getBranchName,
  getIssueKey,
  getLifecycleLabel,
  getPhaseLabel,
  getStatusColor,
  getStepLabel,
  isFailedStatus,
} from './sessionUtils';

function DetailRow({
  label,
  children,
  alignStart = false,
}: {
  label: string;
  children: React.ReactNode;
  alignStart?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:gap-4 ${
        alignStart ? 'md:items-start' : 'md:items-baseline'
      }`}
    >
      <span className="text-text-secondary font-medium text-xs md:text-sm">
        {label}
      </span>
      {children}
    </div>
  );
}

function FailureSummary({
  diagnostic,
}: {
  diagnostic: SessionDiagnostic | null;
}) {
  if (!diagnostic) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="text-text-secondary font-medium text-xs md:text-sm">
        Failure Summary
      </div>
      <div className="bg-black border border-border-color rounded-lg p-3 md:p-4 flex flex-col gap-3">
        <div>
          <div className="text-sm md:text-base font-semibold text-white">
            {diagnostic.summary}
          </div>
          <div className="text-xs text-text-muted mt-1">
            {diagnostic.category}
            {diagnostic.phase ? ` · ${diagnostic.phase}` : ''}
            {typeof diagnostic.exitCode === 'number'
              ? ` · exit ${diagnostic.exitCode}`
              : ''}
          </div>
        </div>
        {diagnostic.command && (
          <div className="font-mono text-xs md:text-[13px] text-gray-300 whitespace-pre-wrap break-all">
            {diagnostic.command}
          </div>
        )}
        {diagnostic.hints.length > 0 && (
          <div className="flex flex-col gap-1">
            {diagnostic.hints.map((hint, index) => (
              <div key={hint} className="text-xs md:text-sm text-gray-300">
                {index + 1}. {hint}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SessionDetails({
  session,
  diagnostic,
  restartingIssues,
  cleaningIssues,
  deletingIssues,
  onRestart,
  onCleanup,
  onDelete,
}: {
  session: DashboardSession;
  diagnostic: SessionDiagnostic | null;
  restartingIssues: Set<string>;
  cleaningIssues: Set<string>;
  deletingIssues: Set<string>;
  onRestart: (session: DashboardSession, event?: React.MouseEvent) => void;
  onCleanup: (session: DashboardSession, event?: React.MouseEvent) => void;
  onDelete: (session: DashboardSession, event?: React.MouseEvent) => void;
}) {
  const key = getIssueKey(session);
  return (
    <div className="min-h-0 lg:overflow-y-auto flex flex-col gap-4 md:gap-6 pr-0 lg:pr-3">
      {isFailedStatus(session.lifecycle) && (
        <FailureSummary diagnostic={diagnostic} />
      )}
      <DetailRow label="Title">
        <span className="text-sm md:text-base">{session.title}</span>
      </DetailRow>
      <DetailRow label="Status">
        <div className="flex items-center gap-3 flex-wrap">
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold capitalize border ${getStatusColor(
              session.lifecycle,
            )}`}
          >
            {getLifecycleLabel(session.lifecycle)}
          </span>
          {isFailedStatus(session.lifecycle) && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-blue-500/10 text-status-running border-blue-500/30 hover:bg-blue-500/25 disabled:cursor-wait"
              onClick={() => onRestart(session)}
              disabled={restartingIssues.has(key)}
            >
              🔄 {restartingIssues.has(key) ? '重启中...' : '重启'}
            </button>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/25 disabled:cursor-wait"
            onClick={() => onDelete(session)}
            disabled={deletingIssues.has(key)}
          >
            🗑️ {deletingIssues.has(key) ? '删除中...' : '彻底删除'}
          </button>
        </div>
      </DetailRow>
      <DetailRow label="Runtime">
        <span className="text-sm md:text-base">{session.runtime}</span>
      </DetailRow>
      <DetailRow label="Current Step">
        <span className="text-sm md:text-base">
          {getStepLabel(session.step)}
        </span>
      </DetailRow>
      <DetailRow label="Phase">
        <span className="text-sm md:text-base">
          {getPhaseLabel(session.phase)}
        </span>
      </DetailRow>
      <DetailRow label="Message">
        <span className="text-sm md:text-base">{session.message || 'N/A'}</span>
      </DetailRow>
      <DetailRow label="Branch">
        <span className="text-sm md:text-base">{getBranchName(session)}</span>
      </DetailRow>
      {session.context?.prNumber && session.context?.prUrl && (
        <DetailRow label="Pull Request">
          <a
            href={session.context.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm md:text-base text-inherit hover:underline"
          >
            PR #{session.context.prNumber}
          </a>
        </DetailRow>
      )}
      {session.hasWorktree && (
        <DetailRow label="Worktree">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm md:text-base opacity-70">📁 存在</span>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/25 disabled:cursor-wait"
              onClick={(event) => onCleanup(session, event)}
              disabled={cleaningIssues.has(key)}
            >
              🗑️ {cleaningIssues.has(key) ? '清理中...' : '删除 Worktree'}
            </button>
          </div>
        </DetailRow>
      )}
      {session.error?.message && (
        <DetailRow label="Error" alignStart>
          <div className="bg-black border border-border-color rounded-lg p-3 md:p-4 font-mono text-xs md:text-[13px] whitespace-pre-wrap text-status-error overflow-x-auto">
            {session.error.message}
          </div>
        </DetailRow>
      )}
      {session.error?.details && (
        <DetailRow label="Crash Log" alignStart>
          <div className="bg-black border border-border-color rounded-lg p-3 md:p-4 font-mono text-xs md:text-[13px] whitespace-pre-wrap text-white overflow-x-auto">
            {session.error.details}
          </div>
        </DetailRow>
      )}
    </div>
  );
}
