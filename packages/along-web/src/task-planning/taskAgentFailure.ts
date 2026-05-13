import type { TaskAgentStageRecord, TaskPlanningSnapshot } from '../types';

const FAILURE_FALLBACK = 'Agent 运行失败，需要查看运行记录后接管。';
const FAILURE_SUMMARY_LIMIT = 120;

function summarizeFailure(error?: string): string {
  const firstLine = error
    ?.split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return FAILURE_FALLBACK;
  return firstLine.length > FAILURE_SUMMARY_LIMIT
    ? `${firstLine.slice(0, FAILURE_SUMMARY_LIMIT)}...`
    : firstLine;
}

export function getLatestFailedAgentStage(
  stages: TaskAgentStageRecord[],
): TaskAgentStageRecord | null {
  return (
    stages
      .filter((stage) => stage.status === 'failed')
      .sort((left, right) =>
        (
          right.latestRun?.endedAt ||
          right.latestRun?.startedAt ||
          ''
        ).localeCompare(
          left.latestRun?.endedAt || left.latestRun?.startedAt || '',
        ),
      )[0] || null
  );
}

export function getTaskFailureSummary(
  snapshot: TaskPlanningSnapshot,
): string | null {
  const failedStage = getLatestFailedAgentStage(snapshot.agentStages || []);
  if (!failedStage) return null;
  return summarizeFailure(failedStage.latestRun?.error);
}
