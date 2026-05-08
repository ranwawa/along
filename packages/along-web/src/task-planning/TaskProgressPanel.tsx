import type {
  TaskAgentProgressEventRecord,
  TaskAgentRunRecord,
  TaskAgentSessionEventRecord,
  TaskAgentSessionEventSource,
  TaskPlanningSnapshot,
} from '../types';
import {
  formatTime,
  getProgressPhaseClass,
  getProgressPhaseLabel,
} from './format';

const RECENT_PROGRESS_LIMIT = 8;
const RECENT_SESSION_LIMIT = 40;
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const STALE_PROGRESS_MINUTES = 2;
const STALE_PROGRESS_MS =
  STALE_PROGRESS_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const SESSION_QUIET_SECONDS = 2 * SECONDS_PER_MINUTE;
const TEXT_PROGRESS_TITLE = '实时进展';
const TEXT_ORCHESTRATION_STATE = 'Along 编排状态';
const TEXT_SESSION_TAIL_TITLE = 'Agent 会话 Tail';

function formatCount(count: number): string {
  return `${count} 条`;
}

function formatHiddenProgressCount(count: number): string {
  return `已折叠较早 ${count} 条进展。`;
}

function formatHiddenSessionCount(count: number): string {
  return `已折叠较早 ${count} 条会话。`;
}

function sortProgressEvents(events: TaskAgentProgressEventRecord[]) {
  return [...events].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function sortSessionEvents(events: TaskAgentSessionEventRecord[]) {
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
  return Math.round((nowMs - time) / MILLISECONDS_PER_SECOND);
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
  const totalSeconds = Math.max(
    1,
    Math.round((nowMs - started) / MILLISECONDS_PER_SECOND),
  );
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

function buildSessionQuietHint(input: {
  runningRun: TaskAgentRunRecord | null;
  latestEvent?: TaskAgentSessionEventRecord;
  nowMs: number;
}): string | null {
  if (!input.runningRun) return null;
  if (!input.latestEvent) {
    return 'Agent 仍在执行，但当前暂无可展示会话信息。';
  }
  const seconds = getRelativeSeconds(input.latestEvent.createdAt, input.nowMs);
  if (seconds === null || seconds < SESSION_QUIET_SECONDS) return null;
  return `最近一条会话在 ${formatRelativeTime(
    input.latestEvent.createdAt,
    input.nowMs,
  )}，Agent 仍处于运行状态。`;
}

function getSessionSourceLabel(source: TaskAgentSessionEventSource): string {
  switch (source) {
    case 'agent':
      return 'Agent';
    case 'tool':
      return 'Tool';
    case 'stdout':
      return 'stdout';
    case 'stderr':
      return 'stderr';
    default:
      return 'System';
  }
}

function getSessionEventClass(event: TaskAgentSessionEventRecord): string {
  if (event.kind === 'error' || event.source === 'stderr') {
    return 'border-red-500/25 bg-red-500/10 text-red-100';
  }
  if (event.source === 'agent') {
    return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-50';
  }
  if (event.source === 'tool' || event.source === 'stdout') {
    return 'border-sky-500/25 bg-sky-500/10 text-sky-50';
  }
  return 'border-border-color bg-black/25 text-text-secondary';
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

function SessionEventItem({
  event,
  nowMs,
}: {
  event: TaskAgentSessionEventRecord;
  nowMs: number;
}) {
  return (
    <li className="grid grid-cols-[72px_1fr] gap-3">
      <div className="text-xs text-text-muted pt-0.5">
        {formatRelativeTime(event.createdAt, nowMs)}
      </div>
      <div
        className={`rounded-lg border px-3 py-2 ${getSessionEventClass(event)}`}
      >
        <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-normal">
          <span>
            {getSessionSourceLabel(event.source)} / {event.provider}
          </span>
          <span>{event.kind}</span>
        </div>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5">
          {event.content}
        </pre>
      </div>
    </li>
  );
}

function SessionTail({
  events,
  runningRun,
  nowMs,
}: {
  events: TaskAgentSessionEventRecord[];
  runningRun: TaskAgentRunRecord | null;
  nowMs: number;
}) {
  const latestEvent = events[events.length - 1];
  const quietHint = buildSessionQuietHint({ runningRun, latestEvent, nowMs });
  const visibleEvents = events.slice(-RECENT_SESSION_LIMIT);
  const hiddenCount = Math.max(0, events.length - visibleEvents.length);

  return (
    <div className="rounded-lg border border-border-color bg-black/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-text-secondary">
            {TEXT_SESSION_TAIL_TITLE}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            {latestEvent
              ? `Codex 实时输出，最近更新 ${formatRelativeTime(
                  latestEvent.createdAt,
                  nowMs,
                )}`
              : '暂无 Codex 实时输出'}
          </div>
        </div>
        <span className="text-xs text-text-muted">
          {formatCount(events.length)}
        </span>
      </div>
      {quietHint && (
        <div className="mb-3 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-200">
          {quietHint}
        </div>
      )}
      {hiddenCount > 0 && (
        <div className="mb-2 text-xs text-text-muted">
          {formatHiddenSessionCount(hiddenCount)}
        </div>
      )}
      {visibleEvents.length === 0 ? (
        <div className="rounded-md border border-border-color bg-black/25 px-3 py-3 text-sm text-text-muted">
          {runningRun
            ? 'Agent 已开始运行，正在等待第一条 Codex 实时输出。'
            : '暂无 Codex 实时输出。'}
        </div>
      ) : (
        <ol className="flex max-h-[520px] flex-col gap-2 overflow-auto pr-1">
          {visibleEvents.map((event) => (
            <SessionEventItem key={event.eventId} event={event} nowMs={nowMs} />
          ))}
        </ol>
      )}
    </div>
  );
}

function ProgressEventsPanel({
  events,
  runningRun,
  nowMs,
}: {
  events: TaskAgentProgressEventRecord[];
  runningRun: TaskAgentRunRecord | null;
  nowMs: number;
}) {
  const latestEvent = events[events.length - 1];
  const runningHint = buildRunningHint({ runningRun, latestEvent, nowMs });
  const visibleEvents = events.slice(-RECENT_PROGRESS_LIMIT);
  const hiddenCount = Math.max(0, events.length - visibleEvents.length);

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-border-color bg-black/25 px-4 py-3 text-sm text-text-muted">
        {runningHint ||
          (runningRun
            ? 'Agent 已开始运行，正在等待第一条进展。'
            : '暂无 Agent 运行进展。')}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border-color bg-black/20 p-3">
      {runningHint && (
        <div className="mb-3 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-200">
          {runningHint}
        </div>
      )}
      {hiddenCount > 0 && (
        <div className="mb-2 text-xs text-text-muted">
          {formatHiddenProgressCount(hiddenCount)}
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
  const sessionEvents = sortSessionEvents(snapshot.agentSessionEvents || []);
  const runningRun = getLatestRunningRun(snapshot.agentRuns || []);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-secondary">
            {TEXT_PROGRESS_TITLE}
          </h3>
          <div className="mt-1 text-xs text-text-muted">
            {TEXT_ORCHESTRATION_STATE}
          </div>
        </div>
        <span className="text-xs text-text-muted">
          {formatCount(events.length)}
        </span>
      </div>

      <ProgressEventsPanel
        events={events}
        runningRun={runningRun}
        nowMs={nowMs}
      />
      <SessionTail
        events={sessionEvents}
        runningRun={runningRun}
        nowMs={nowMs}
      />
    </section>
  );
}
