// biome-ignore-all lint/style/noJsxLiterals: existing dashboard drawer uses compact inline title labels.
import { Sheet, SheetContent } from '../components/ui/sheet';
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
    <Sheet open={true} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        title={
          <>
            {session.owner}/{session.repo} #{session.issueNumber}
            {session.hasWorktree && <span className="ml-2 opacity-70">WT</span>}
          </>
        }
        className="animate-[slideInRight_0.28s_cubic-bezier(0.16,1,0.3,1)]"
      >
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
      </SheetContent>
    </Sheet>
  );
}
