// biome-ignore-all lint/style/noJsxLiterals: existing task planning views use inline Chinese labels.
import { LoaderCircle, RotateCw } from 'lucide-react';
import { Button } from '../components/ui/button';
import type { TaskFlowAction, TaskPlanningSnapshot } from '../types';
import {
  getLatestFailedAgentStage,
  getTaskFailureSummary,
} from './taskAgentFailure';

const RETRY_FAILED_STAGE_ACTION_ID = 'resume_failed_stage';

function getRetryFailedStageAction(
  snapshot: TaskPlanningSnapshot,
): TaskFlowAction | undefined {
  return snapshot.flow.actions.find(
    (action) => action.id === RETRY_FAILED_STAGE_ACTION_ID && action.enabled,
  );
}

function getRetryBusyAction(snapshot: TaskPlanningSnapshot): string | null {
  const failedStage = getLatestFailedAgentStage(snapshot.agentStages || []);
  return failedStage ? `resume-${failedStage.stage}` : null;
}

export function TaskFailureBanner({
  snapshot,
  busyAction,
  onRetry,
}: {
  snapshot: TaskPlanningSnapshot;
  busyAction: string | null;
  onRetry: (action: TaskFlowAction) => void;
}) {
  const summary = getTaskFailureSummary(snapshot);
  if (!summary) return null;

  const retryAction = getRetryFailedStageAction(snapshot);
  const retryBusyAction = getRetryBusyAction(snapshot);
  const retrying = Boolean(retryBusyAction && busyAction === retryBusyAction);

  return (
    <section className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="font-semibold">Agent 运行失败</div>
          <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-rose-100/90">
            {summary}
          </div>
        </div>
        {retryAction && (
          <Button
            type="button"
            onClick={() => onRetry(retryAction)}
            disabled={Boolean(busyAction)}
            title={retryAction.description}
            size="sm"
            className="gap-1.5 border-rose-300/45 bg-rose-400/15 text-rose-50 hover:bg-rose-400/25 focus:ring-rose-300/50"
          >
            {retrying ? (
              <LoaderCircle
                aria-hidden="true"
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
              />
            ) : (
              <RotateCw aria-hidden="true" className="h-4 w-4" />
            )}
            {retrying ? '重试中' : retryAction.label}
          </Button>
        )}
      </div>
    </section>
  );
}
