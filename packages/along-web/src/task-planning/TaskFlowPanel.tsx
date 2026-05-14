// biome-ignore-all lint/style/noJsxLiterals: existing task flow panel uses inline labels.
import { useEffect, useState } from 'react';
import { Sheet, SheetContent } from '../components/ui/sheet';
import type {
  TaskFlowAction,
  TaskFlowSnapshot,
  TaskPlanRevisionRecord,
} from '../types';
import { formatTime } from './format';
import { MarkdownContent } from './MarkdownContent';
import { FlowStages } from './TaskFlowStageCard';

const CURRENT_PLAN_DIALOG_WIDTH = {
  defaultWidth: 320,
  minWidth: 280,
  maxWidth: 640,
  minMainWidth: 280,
};

export function TaskFlowPanel({
  flow,
  currentPlan,
  busyAction,
  onAction,
}: {
  flow: TaskFlowSnapshot;
  currentPlan: TaskPlanRevisionRecord | null;
  busyAction: string | null;
  onAction: (action: TaskFlowAction) => void;
}) {
  const [openStageId, setOpenStageId] = useState<string | null>(
    flow.currentStageId,
  );
  const [isPlanOpen, setIsPlanOpen] = useState(false);
  const commandActions = flow.actions.filter(
    (action) =>
      !['submit_feedback', 'request_revision', 'request_changes'].includes(
        action.id,
      ),
  );

  useEffect(() => {
    setOpenStageId(flow.currentStageId);
  }, [flow.currentStageId]);

  return (
    <section className="flex flex-col gap-4">
      <FlowSummary flow={flow} />
      <FlowStages
        stages={flow.stages}
        commandActions={commandActions}
        busyAction={busyAction}
        currentPlan={currentPlan}
        onAction={onAction}
        onShowPlan={() => setIsPlanOpen(true)}
        openStageId={openStageId}
        onOpenStageChange={setOpenStageId}
      />
      <CurrentPlanDialog
        plan={currentPlan}
        open={isPlanOpen}
        onClose={() => setIsPlanOpen(false)}
      />
    </section>
  );
}

function FlowSummary({ flow }: { flow: TaskFlowSnapshot }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-semibold text-text-primary">
        {flow.conclusion}
      </div>
      {flow.blockers.length > 0 && (
        <div className="text-xs leading-5 text-amber-100">
          {flow.blockers.map((blocker) => (
            <div key={blocker}>{blocker}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CurrentPlanDialog({
  plan,
  open,
  onClose,
}: {
  plan: TaskPlanRevisionRecord | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!plan) return null;
  return (
    <Sheet
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <SheetContent
        title={`当前计划 v${plan.version}`}
        showOverlay={false}
        resizable={CURRENT_PLAN_DIALOG_WIDTH}
        className="animate-[slideInRight_0.22s_cubic-bezier(0.16,1,0.3,1)]"
      >
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <MarkdownContent value={plan.body} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function FlowHistory({
  flow,
  defaultOpen = false,
}: {
  flow: TaskFlowSnapshot;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="rounded-lg border border-border-color bg-black/20"
      open={defaultOpen || undefined}
    >
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-text-secondary">
        历史流转
      </summary>
      <div className="px-4 pb-4 flex flex-col gap-2">
        {flow.events.length === 0 ? (
          <div className="text-sm text-text-muted">暂无历史事件。</div>
        ) : (
          flow.events.map((event) => (
            <div
              key={event.eventId}
              className="grid grid-cols-[86px_1fr] gap-3 rounded-md border border-white/5 bg-black/20 px-3 py-2 text-xs"
            >
              <span className="text-text-muted">
                {formatTime(event.occurredAt)}
              </span>
              <span className="min-w-0">
                <span className="text-text-secondary">{event.title}</span>
                {event.summary && (
                  <span className="text-text-muted"> · {event.summary}</span>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </details>
  );
}
