import { useState } from 'react';
import type { TaskFlowAction, TaskFlowSnapshot } from '../types';
import { formatTime, getFlowSeverityClass } from './format';
import { FlowStages } from './TaskFlowStageCard';

export function TaskFlowPanel({
  flow,
  busyAction,
  onAction,
}: {
  flow: TaskFlowSnapshot;
  busyAction: string | null;
  onAction: (action: TaskFlowAction) => void;
}) {
  const [openStageId, setOpenStageId] = useState<string | null>(null);
  const commandActions = flow.actions.filter(
    (action) =>
      !['submit_feedback', 'request_revision', 'request_changes'].includes(
        action.id,
      ),
  );

  return (
    <section className="rounded-lg border border-border-color bg-black/25 p-4 md:p-5 flex flex-col gap-4">
      <FlowSummary flow={flow} />
      <FlowStages
        stages={flow.stages}
        currentStageId={flow.currentStageId}
        commandActions={commandActions}
        busyAction={busyAction}
        onAction={onAction}
        openStageId={openStageId}
        onOpenStageChange={setOpenStageId}
      />
      <FlowHistory flow={flow} />
    </section>
  );
}

function FlowSummary({ flow }: { flow: TaskFlowSnapshot }) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className={`rounded-lg border px-4 py-3 ${getFlowSeverityClass(
          flow.severity,
        )}`}
      >
        <div className="text-xs text-text-muted mb-1">当前节奏</div>
        <div className="text-base font-semibold">{flow.conclusion}</div>
      </div>
      {flow.blockers.length > 0 && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-100">
          {flow.blockers.map((blocker) => (
            <div key={blocker}>{blocker}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function FlowHistory({ flow }: { flow: TaskFlowSnapshot }) {
  return (
    <details className="rounded-lg border border-border-color bg-black/20">
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
