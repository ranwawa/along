import { SessionDrawer } from './SessionDrawer';
import { SessionList } from './SessionList';
import type { useDashboardSessions } from './useDashboardSessions';
import { useSessionLogs } from './useSessionLogs';

type SessionsController = ReturnType<typeof useDashboardSessions>;

export function SessionsView({ sessions }: { sessions: SessionsController }) {
  const logs = useSessionLogs(sessions.selectedSession);

  return (
    <>
      <div className="flex-1 min-h-0 px-0 md:px-0">
        <div className="h-full bg-bg-glass backdrop-blur-md border-x-0 md:border-x-0 border-y-0 md:border-y-0 border border-border-color rounded-none flex flex-col overflow-hidden min-h-[300px]">
          <div className="px-4 py-3 md:px-6 md:py-5 border-b border-border-color font-semibold text-sm md:text-base flex justify-between items-center">
            <span>Recent Tasks</span>
            <div className="relative">
              <input
                type="text"
                placeholder="Filter by repo..."
                value={sessions.repoFilter}
                onChange={(event) => sessions.setRepoFilter(event.target.value)}
                className="bg-white/5 border border-border-color rounded-lg px-3 py-1 text-xs md:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/50 w-32 md:w-48 transition-all"
              />
              {sessions.repoFilter && (
                <button
                  type="button"
                  onClick={() => sessions.setRepoFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-white bg-transparent border-none cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          <SessionList
            sessions={sessions.filteredSessions}
            restartingIssues={sessions.restartingIssues}
            deletingIssues={sessions.deletingIssues}
            onSelect={sessions.setSelectedSession}
            onRestart={sessions.restartSession}
            onDelete={sessions.deleteSessionAssets}
          />
        </div>
      </div>

      {sessions.selectedSession && (
        <SessionDrawer
          session={sessions.selectedSession}
          logs={logs}
          restartingIssues={sessions.restartingIssues}
          cleaningIssues={sessions.cleaningIssues}
          deletingIssues={sessions.deletingIssues}
          onClose={() => sessions.setSelectedSession(null)}
          onRestart={sessions.restartSession}
          onCleanup={sessions.cleanupWorktree}
          onDelete={sessions.deleteSessionAssets}
        />
      )}
    </>
  );
}
