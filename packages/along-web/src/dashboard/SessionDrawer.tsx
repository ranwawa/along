import type { DashboardSession } from '../types';
import { SessionDetails } from './SessionDetails';
import { SessionLogsPanel } from './SessionLogsPanel';
import type { useSessionLogs } from './useSessionLogs';

type SessionLogsState = ReturnType<typeof useSessionLogs>;

export function SessionDrawer({
  session,
  logs,
  restartingIssues,
  cleaningIssues,
  deletingIssues,
  onClose,
  onRestart,
  onCleanup,
  onDelete,
}: {
  session: DashboardSession;
  logs: SessionLogsState;
  restartingIssues: Set<string>;
  cleaningIssues: Set<string>;
  deletingIssues: Set<string>;
  onClose: () => void;
  onRestart: (session: DashboardSession, event?: React.MouseEvent) => void;
  onCleanup: (session: DashboardSession, event?: React.MouseEvent) => void;
  onDelete: (session: DashboardSession, event?: React.MouseEvent) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 animate-[fadeIn_0.2s_ease]">
      <button
        type="button"
        aria-label="Close session details"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="absolute inset-y-0 right-0 bg-bg-secondary border-l border-border-color w-full md:w-[88vw] xl:w-[82vw] max-w-[1280px] flex flex-col shadow-2xl animate-[slideInRight_0.28s_cubic-bezier(0.16,1,0.3,1)]">
        <div className="p-4 md:p-6 border-b border-border-color flex justify-between items-center shrink-0">
          <h2 className="text-base md:text-xl font-bold truncate mr-2">
            {session.owner}/{session.repo} #{session.issueNumber}
            {session.hasWorktree && <span className="ml-2 opacity-70">📁</span>}
          </h2>
          <button
            type="button"
            className="bg-transparent border-none text-text-secondary cursor-pointer p-2 rounded-lg transition-colors hover:bg-white/10 hover:text-white shrink-0"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0 p-4 md:p-6">
          <div className="h-full min-h-0 flex flex-col gap-4 md:gap-6 lg:grid lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] lg:gap-6">
            <SessionDetails
              session={session}
              diagnostic={logs.selectedDiagnostic}
              restartingIssues={restartingIssues}
              cleaningIssues={cleaningIssues}
              deletingIssues={deletingIssues}
              onRestart={onRestart}
              onCleanup={onCleanup}
              onDelete={onDelete}
            />
            <SessionLogsPanel logs={logs} />
          </div>
        </div>
      </div>
    </div>
  );
}
