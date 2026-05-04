import type { TaskFlowAction, TaskFlowStage } from '../types';
import {
  getFlowActionClass,
  getFlowStageDotClass,
  getFlowStageStateClass,
} from './format';

function getStageActionScope(
  actions: TaskFlowAction[],
  stage: TaskFlowStage,
): TaskFlowAction[] {
  const stageActions = actions.filter((action) => action.stage === stage.id);
  return stageActions.length > 0 ? stageActions : actions;
}

export function FlowStages({
  stages,
  currentStageId,
  commandActions,
  busyAction,
  onAction,
  openStageId,
  onOpenStageChange,
}: {
  stages: TaskFlowStage[];
  currentStageId: string;
  commandActions: TaskFlowAction[];
  busyAction: string | null;
  onAction: (action: TaskFlowAction) => void;
  openStageId: string | null;
  onOpenStageChange: (stageId: string | null) => void;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {stages.map((stage) => {
        const isCurrent = stage.id === currentStageId;
        return (
          <FlowStageItem
            key={stage.id}
            stage={stage}
            actions={commandActions}
            busyAction={busyAction}
            isCurrent={isCurrent}
            isOpen={openStageId === stage.id}
            onAction={onAction}
            onOpenChange={(isOpen) =>
              onOpenStageChange(isOpen ? stage.id : null)
            }
          />
        );
      })}
    </div>
  );
}

function FlowStageItem({
  stage,
  actions,
  busyAction,
  isCurrent,
  isOpen,
  onAction,
  onOpenChange,
}: {
  stage: TaskFlowStage;
  actions: TaskFlowAction[];
  busyAction: string | null;
  isCurrent: boolean;
  isOpen: boolean;
  onAction: (action: TaskFlowAction) => void;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const scopedActions = getStageActionScope(actions, stage);
  const enabledActions = scopedActions.filter((action) => action.enabled);
  const disabledActions = scopedActions.filter(
    (action) => !action.enabled && action.disabledReason,
  );

  return (
    <div
      className={`group min-w-[180px] flex-1 rounded-lg border p-3 transition-colors ${getFlowStageStateClass(
        stage.state,
      )}`}
    >
      <FlowStageToggle
        stage={stage}
        isCurrent={isCurrent}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
      />
      {isCurrent && (
        <FlowStageDetails
          stage={stage}
          enabledActions={enabledActions}
          disabledActions={disabledActions}
          busyAction={busyAction}
          isOpen={isOpen}
          onAction={onAction}
        />
      )}
    </div>
  );
}

function FlowStageToggle({
  stage,
  isCurrent,
  isOpen,
  onOpenChange,
}: {
  stage: TaskFlowStage;
  isCurrent: boolean;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={!isCurrent}
      onClick={() => onOpenChange(!isOpen)}
      className="w-full text-left outline-none disabled:cursor-default"
    >
      <FlowStageSummary stage={stage} />
    </button>
  );
}

function FlowStageSummary({ stage }: { stage: TaskFlowStage }) {
  return (
    <>
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
    </>
  );
}

function FlowStageDetails({
  stage,
  enabledActions,
  disabledActions,
  busyAction,
  isOpen,
  onAction,
}: {
  stage: TaskFlowStage;
  enabledActions: TaskFlowAction[];
  disabledActions: TaskFlowAction[];
  busyAction: string | null;
  isOpen: boolean;
  onAction: (action: TaskFlowAction) => void;
}) {
  return (
    <div
      className={`mt-3 rounded-md border border-white/10 bg-black/25 p-3 ${
        isOpen ? 'block' : 'hidden group-hover:block group-focus-within:block'
      }`}
    >
      <FlowStageDetailText stage={stage} />
      <FlowStageActionList
        actions={enabledActions}
        busyAction={busyAction}
        onAction={onAction}
      />
      <FlowDisabledReasonList actions={disabledActions} />
    </div>
  );
}

function FlowStageDetailText({ stage }: { stage: TaskFlowStage }) {
  return (
    <>
      <div className="text-xs font-semibold text-text-secondary">
        当前状态详情
      </div>
      {stage.details.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 text-xs leading-5 text-text-secondary">
          {stage.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : (
        <div className="mt-2 text-xs text-text-muted">
          当前状态暂无更多详情。
        </div>
      )}
    </>
  );
}

function FlowStageActionList({
  actions,
  busyAction,
  onAction,
}: {
  actions: TaskFlowAction[];
  busyAction: string | null;
  onAction: (action: TaskFlowAction) => void;
}) {
  return (
    <>
      <div className="mt-3 text-xs font-semibold text-text-secondary">
        可执行操作
      </div>
      {actions.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {actions.map((action) => (
            <FlowActionButton
              key={action.id}
              action={action}
              busy={Boolean(busyAction)}
              onClick={onAction}
            />
          ))}
        </div>
      ) : (
        <div className="mt-2 text-xs text-text-muted">
          当前状态暂无可执行操作。
        </div>
      )}
    </>
  );
}

function FlowDisabledReasonList({ actions }: { actions: TaskFlowAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-2">
      {actions.map((action) => (
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
