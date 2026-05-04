import type { TaskFlowAction, TaskFlowSnapshot, TaskFlowStage } from '../types';
import {
  formatTime,
  getFlowActionClass,
  getFlowSeverityClass,
  getFlowStageDotClass,
  getFlowStageStateClass,
} from './format';

function FlowStageItem({ stage }: { stage: TaskFlowStage }) {
  return (
    <div
      className={`min-w-[160px] flex-1 rounded-lg border p-3 ${getFlowStageStateClass(
        stage.state,
      )}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full shrink-0 ${getFlowStageDotClass(
            stage.state,
          )}`}
        />
        <span className="text-sm font-semibold">{stage.label}</span>
      </div>
      <div className="mt-2 text-xs leading-5 text-text-secondary">
        {stage.summary}
      </div>
      {stage.blocker && (
        <div className="mt-2 text-xs leading-5 text-rose-200">
          {stage.blocker}
        </div>
      )}
    </div>
  );
}

function FlowActionButton({
  action,
  busy,
  onClick,
}: {
  action: TaskFlowAction;
  busy: boolean;
  onClick: (action: TaskFlowAction) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(action)}
      disabled={!action.enabled || busy}
      title={!action.enabled ? action.disabledReason : action.description}
      className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${getFlowActionClass(
        action,
      )}`}
    >
      {busy ? '处理中' : action.label}
    </button>
  );
}

export function TaskFlowPanel({
  flow,
  busyAction,
  onAction,
}: {
  flow: TaskFlowSnapshot;
  busyAction: string | null;
  onAction: (action: TaskFlowAction) => void;
}) {
  const commandActions = flow.actions.filter(
    (action) =>
      !['submit_feedback', 'request_revision', 'request_changes'].includes(
        action.id,
      ),
  );

  return (
    <section className="rounded-lg border border-border-color bg-black/25 p-4 md:p-5 flex flex-col gap-4">
      <FlowSummary flow={flow} />
      <FlowStages stages={flow.stages} />
      <FlowActions
        actions={flow.actions}
        commandActions={commandActions}
        busyAction={busyAction}
        onAction={onAction}
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

function FlowStages({ stages }: { stages: TaskFlowStage[] }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {stages.map((stage) => (
        <FlowStageItem key={stage.id} stage={stage} />
      ))}
    </div>
  );
}

function FlowActions({
  actions,
  commandActions,
  busyAction,
  onAction,
}: {
  actions: TaskFlowAction[];
  commandActions: TaskFlowAction[];
  busyAction: string | null;
  onAction: (action: TaskFlowAction) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-semibold text-text-secondary">
        可执行操作
      </div>
      <div className="flex flex-wrap gap-2">
        {commandActions.map((action) => (
          <FlowActionButton
            key={action.id}
            action={action}
            busy={Boolean(busyAction)}
            onClick={onAction}
          />
        ))}
      </div>
      <FlowDisabledReasons actions={actions} />
    </div>
  );
}

function FlowDisabledReasons({ actions }: { actions: TaskFlowAction[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {actions
        .filter((action) => !action.enabled && action.disabledReason)
        .map((action) => (
          <div
            key={action.id}
            className="rounded-md border border-border-color bg-black/20 px-3 py-2 text-xs leading-5 text-text-muted"
          >
            <span className="text-text-secondary">{action.label}</span>：
            {action.disabledReason}
          </div>
        ))}
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
