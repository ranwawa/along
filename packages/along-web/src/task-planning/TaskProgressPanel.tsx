import type {
  TaskAgentProgressEventRecord,
  TaskAgentRunRecord,
  TaskPlanningSnapshot,
} from '../types';
import {
  formatTime,
  getProgressPhaseClass,
  getProgressPhaseLabel,
} from './format';

const RECENT_PROGRESS_LIMIT = 8;
const STALE_PROGRESS_MS = 2 * 60 * 1000;

function sortProgressEvents(events: TaskAgentProgressEventRecord[]) {
  return [...events].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function getLatestRunningRun(
  runs: TaskAgentRunRecord[],
): TaskAgentRunRecord | null {
  return (
    runs
      .filter((run) => run.status === 'running')
      .sort((left, right) =>
        right.startedAt.localeCompare(left.startedAt),
      )[0] || null
  );
}

function getRelativeSeconds(value: string, nowMs: number): number | null {
  const time = new Date(value).getTime();
  if (Number.isNaN(time) || nowMs < time) return null;
  return Math.round((nowMs - time) / 1000);
}

function formatRelativeTime(value: string, nowMs: number): string {
  const seconds = getRelativeSeconds(value, nowMs);
  if (seconds === null) return formatTime(value);
  if (seconds < 60) return `${Math.max(1, seconds)} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.floor(minutes / 60)} 小时前`;
}

function formatDurationToNow(startedAt: string, nowMs: number): string {
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started) || nowMs < started) return '-';
  const totalSeconds = Math.max(1, Math.round((nowMs - started) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function buildRunningHint(input: {
  runningRun: TaskAgentRunRecord | null;
  latestEvent?: TaskAgentProgressEventRecord;
  nowMs: number;
}): string | null {
  if (!input.runningRun) return null;
  const lastTime = input.latestEvent?.createdAt || input.runningRun.startedAt;
  const lastMs = new Date(lastTime).getTime();
  const stale =
    Number.isNaN(lastMs) || input.nowMs - lastMs >= STALE_PROGRESS_MS;
  if (!stale) return null;
  return `仍在执行，已运行 ${formatDurationToNow(
    input.runningRun.startedAt,
    input.nowMs,
  )}，最近一次进展在 ${formatRelativeTime(lastTime, input.nowMs)}。`;
}

function ProgressEventItem({
  event,
  isLatest,
  nowMs,
}: {
  event: TaskAgentProgressEventRecord;
  isLatest: boolean;
  nowMs: number;
}) {
  return (
    <li className="grid grid-cols-[72px_1fr] gap-3">
      <div className="text-xs text-text-muted pt-0.5">
        {formatRelativeTime(event.createdAt, nowMs)}
      </div>
      <div
        className={`rounded-lg border px-3 py-2 ${
          isLatest
            ? getProgressPhaseClass(event.phase)
            : 'border-border-color bg-black/25'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">{event.summary}</div>
          <span className="shrink-0 text-[10px] font-semibold">
            {getProgressPhaseLabel(event.phase)}
          </span>
        </div>
        <div className="mt-1 text-xs text-text-muted">
          {event.provider} / {event.agentId}
        </div>
        {event.detail && (
          <div className="mt-2 text-xs leading-5 text-text-secondary whitespace-pre-wrap break-words">
            {event.detail}
          </div>
        )}
      </div>
    </li>
  );
}

export function TaskProgressPanel({
  snapshot,
  nowMs = Date.now(),
}: {
  snapshot: TaskPlanningSnapshot;
  nowMs?: number;
}) {
  const events = sortProgressEvents(snapshot.agentProgressEvents || []);
  const runningRun = getLatestRunningRun(snapshot.agentRuns || []);
  const latestEvent = events[events.length - 1];
  const runningHint = buildRunningHint({ runningRun, latestEvent, nowMs });
  const visibleEvents = events.slice(-RECENT_PROGRESS_LIMIT);
  const hiddenCount = Math.max(0, events.length - visibleEvents.length);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-secondary">实时进展</h3>
        <span className="text-xs text-text-muted">{events.length} 条</span>
      </div>

      {events.length === 0 ? (
        <div className="rounded-lg border border-border-color bg-black/25 px-4 py-3 text-sm text-text-muted">
          {runningHint ||
            (runningRun
              ? 'Agent 已开始运行，正在等待第一条进展。'
              : '暂无 Agent 运行进展。')}
        </div>
      ) : (
        <div className="rounded-lg border border-border-color bg-black/20 p-3">
          {runningHint && (
            <div className="mb-3 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-200">
              {runningHint}
            </div>
          )}
          {latestEvent && (
            <div className="mb-3 rounded-md border border-cyan-500/25 bg-cyan-500/10 px-3 py-2">
              <div className="text-xs text-text-muted">当前状态</div>
              <div className="mt-1 text-sm font-semibold text-cyan-100">
                {latestEvent.summary}
              </div>
            </div>
          )}
          {hiddenCount > 0 && (
            <div className="mb-2 text-xs text-text-muted">
              已折叠较早 {hiddenCount} 条进展。
            </div>
          )}
          <ol className="flex flex-col gap-2">
            {visibleEvents.map((event, index) => (
              <ProgressEventItem
                key={event.progressId}
                event={event}
                isLatest={index === visibleEvents.length - 1}
                nowMs={nowMs}
              />
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
