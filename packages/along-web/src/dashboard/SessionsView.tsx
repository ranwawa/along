// biome-ignore-all lint/style/noJsxLiterals: existing dashboard view uses inline labels and compact controls.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: sessions layout and drawer composition are kept together.
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
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
              <Input
                type="text"
                placeholder="Filter by repo..."
                value={sessions.repoFilter}
                onChange={(event) => sessions.setRepoFilter(event.target.value)}
                className="w-32 bg-white/5 py-1 text-xs transition-all focus:ring-blue-500/50 md:w-48 md:text-sm"
              />
              {sessions.repoFilter && (
                <Button
                  type="button"
                  onClick={() => sessions.setRepoFilter('')}
                  variant="ghost"
                  size="xs"
                  className="absolute right-1 top-1/2 h-6 -translate-y-1/2 border-none px-1.5"
                >
                  x
                </Button>
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
