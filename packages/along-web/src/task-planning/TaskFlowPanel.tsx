// biome-ignore-all lint/style/noJsxLiterals: existing task flow panel uses inline labels.
import { useEffect, useState } from 'react';
import type {
  TaskFlowAction,
  TaskFlowSnapshot,
  TaskPlanRevisionRecord,
} from '../types';
import { formatTime } from './format';
import { MarkdownContent } from './MarkdownContent';
import { FlowStages } from './TaskFlowStageCard';

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
  if (!open || !plan) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-lg border border-border-color bg-bg-secondary shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-border-color px-4 py-3">
          <h3 className="text-sm font-semibold text-text-secondary">
            当前计划 v{plan.version}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border-color px-2 py-1 text-xs font-semibold text-text-secondary hover:bg-white/5"
          >
            关闭
          </button>
        </div>
        <div className="min-h-0 overflow-auto p-4">
          <MarkdownContent value={plan.body} />
        </div>
      </div>
    </div>
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
