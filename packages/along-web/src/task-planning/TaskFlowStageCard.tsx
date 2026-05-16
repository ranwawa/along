import { Eye, LoaderCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import type {
  TaskFlowAction,
  TaskFlowStage,
  TaskPlanRevisionRecord,
} from '../types';
import { getFlowActionClass, getFlowStageDotClass } from './flowFormat';

const LABELS = {
  availableActions: '可执行操作',
  noDetails: '当前状态暂无更多详情。',
  noActions: '当前状态暂无可执行操作。',
  processing: '处理中',
  viewPlan: (version: number) => `查看计划 v${version}`,
  disabledReasonSep: '：',
} as const;

export function getStageActionScope(
  actions: TaskFlowAction[],
  stage: TaskFlowStage,
): TaskFlowAction[] {
  const stageActions = actions.filter((action) => action.stage === stage.id);
  if (
    stage.state === 'current' ||
    stage.state === 'blocked' ||
    stage.state === 'attention'
  ) {
    return stageActions;
  }
  return stageActions.length > 0 ? stageActions : actions;
}

export function FlowStages({
  stages,
  commandActions,
  busyAction,
  currentPlan,
  onAction,
  onShowPlan,
  openStageId,
  onOpenStageChange,
}: {
  stages: TaskFlowStage[];
  commandActions: TaskFlowAction[];
  busyAction: string | null;
  currentPlan: TaskPlanRevisionRecord | null;
  onAction: (action: TaskFlowAction) => void;
  onShowPlan: () => void;
  openStageId: string | null;
  onOpenStageChange: (stageId: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {stages.map((stage) => {
        const isCurrent =
          stage.state === 'current' ||
          stage.state === 'blocked' ||
          stage.state === 'attention';
        return (
          <FlowStageItem
            key={stage.id}
            stage={stage}
            actions={commandActions}
            busyAction={busyAction}
            currentPlan={currentPlan}
            isCurrent={isCurrent}
            isOpen={openStageId === stage.id}
            onAction={onAction}
            onShowPlan={onShowPlan}
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
  currentPlan,
  isCurrent,
  isOpen,
  onAction,
  onShowPlan,
  onOpenChange,
}: {
  stage: TaskFlowStage;
  actions: TaskFlowAction[];
  busyAction: string | null;
  currentPlan: TaskPlanRevisionRecord | null;
  isCurrent: boolean;
  isOpen: boolean;
  onAction: (action: TaskFlowAction) => void;
  onShowPlan: () => void;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const scopedActions = getStageActionScope(actions, stage);
  const enabledActions = scopedActions.filter((action) => action.enabled);
  const disabledActions = scopedActions.filter(
    (action) => !action.enabled && action.disabledReason,
  );

  return (
    <div className="group border-l border-border-color pl-3">
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
          currentPlan={currentPlan}
          isOpen={isOpen}
          onAction={onAction}
          onShowPlan={onShowPlan}
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
      className="w-full text-left outline-none disabled:cursor-default focus:ring-1 focus:ring-brand/60"
      aria-expanded={isCurrent ? isOpen : undefined}
    >
      <FlowStageSummary stage={stage} isCurrent={isCurrent} />
    </button>
  );
}

function FlowStageSummary({
  stage,
  isCurrent,
}: {
  stage: TaskFlowStage;
  isCurrent: boolean;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2 py-1">
      <div className="flex h-5 shrink-0 items-center">
        <span
          className={`h-2.5 w-2.5 rounded-full shrink-0 ${getFlowStageDotClass(
            stage.state,
          )}`}
        />
      </div>
      <div className="min-w-0 flex-1 text-sm leading-5">
        <span
          className={
            isCurrent ? 'font-semibold text-text-primary' : 'text-text-muted'
          }
        >
          {stage.label}
        </span>
        <span className="text-text-muted"> · {stage.summary}</span>
        {stage.blocker && (
          <div className="mt-1 text-xs leading-5 text-rose-200">
            {stage.blocker}
          </div>
        )}
      </div>
    </div>
  );
}

function FlowStageDetails({
  stage,
  enabledActions,
  disabledActions,
  busyAction,
  currentPlan,
  isOpen,
  onAction,
  onShowPlan,
}: {
  stage: TaskFlowStage;
  enabledActions: TaskFlowAction[];
  disabledActions: TaskFlowAction[];
  busyAction: string | null;
  currentPlan: TaskPlanRevisionRecord | null;
  isOpen: boolean;
  onAction: (action: TaskFlowAction) => void;
  onShowPlan: () => void;
}) {
  return (
    <div className={`ml-4 pb-3 pt-1 ${isOpen ? 'block' : 'hidden'}`}>
      <FlowStageDetailText stage={stage} />
      {stage.id === 'plan_confirmation' && currentPlan && (
        <Button
          type="button"
          onClick={onShowPlan}
          size="sm"
          className="mt-3 gap-1.5"
        >
          <Eye aria-hidden="true" className="h-4 w-4" />
          {LABELS.viewPlan(currentPlan.version)}
        </Button>
      )}
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
      {stage.details.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs leading-5 text-text-secondary">
          {stage.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-text-muted">{LABELS.noDetails}</div>
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
        {LABELS.availableActions}
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
        <div className="mt-2 text-xs text-text-muted">{LABELS.noActions}</div>
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
          <span className="text-text-secondary">
            {action.label}
            {LABELS.disabledReasonSep}
          </span>
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
    <Button
      type="button"
      onClick={() => onClick(action)}
      disabled={!action.enabled || busy}
      title={!action.enabled ? action.disabledReason : action.description}
      size="sm"
      className={`${getFlowActionClass(action)} gap-1.5`}
    >
      {busy && (
        <LoaderCircle
          aria-hidden="true"
          className="h-4 w-4 animate-spin motion-reduce:animate-none"
        />
      )}
      {busy ? LABELS.processing : action.label}
    </Button>
  );
}
