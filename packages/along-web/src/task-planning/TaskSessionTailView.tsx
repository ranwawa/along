// biome-ignore-all lint/style/noJsxLiterals: task planning panels use existing inline labels.
// biome-ignore-all lint/style/noMagicNumbers: task planning layout uses fixed UI thresholds.
import { type RefObject, useEffect, useRef } from 'react';
import type {
  TaskAgentRunRecord,
  TaskAgentSessionEventRecord,
  TaskAgentSessionEventSource,
  TaskPlanningSnapshot,
} from '../types';
import { formatTime } from './format';

const RECENT_SESSION_LIMIT = 40;
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SESSION_QUIET_SECONDS = 2 * SECONDS_PER_MINUTE;
const TEXT_SESSION_TAIL_TITLE = 'Agent 会话 Tail';

function formatCount(count: number): string {
  return `${count} 条`;
}

function formatHiddenSessionCount(count: number): string {
  return `已折叠较早 ${count} 条会话。`;
}

function getRuntimeLabel(runtimeId: string): string {
  return runtimeId || '-';
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

function SessionEventItem({ event }: { event: TaskAgentSessionEventRecord }) {
  return (
    <li>
      <div
        className={`rounded-lg border px-3 py-2 ${getSessionEventClass(event)}`}
      >
        <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-normal">
          <span>
            {`${getSessionSourceLabel(event.source)} / Runtime: ${getRuntimeLabel(
              event.runtimeId,
            )}`}
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

function useAutoScrollToBottom(
  scrollRef: RefObject<HTMLOListElement | null>,
  scrollKey: string,
) {
  useEffect(() => {
    void scrollKey;
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [scrollRef, scrollKey]);
}

function SessionTailHeader({
  events,
  latestEvent,
  nowMs,
}: {
  events: TaskAgentSessionEventRecord[];
  latestEvent?: TaskAgentSessionEventRecord;
  nowMs: number;
}) {
  return (
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
  );
}

function SessionEventList({
  events,
  scrollRef,
}: {
  events: TaskAgentSessionEventRecord[];
  scrollRef: RefObject<HTMLOListElement | null>;
}) {
  return (
    <ol
      ref={scrollRef}
      className="flex max-h-[520px] flex-col gap-2 overflow-auto pr-1"
    >
      {events.map((event) => (
        <SessionEventItem key={event.eventId} event={event} />
      ))}
    </ol>
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
  const scrollRef = useRef<HTMLOListElement>(null);
  const latestEvent = events[events.length - 1];
  const quietHint = buildSessionQuietHint({ runningRun, latestEvent, nowMs });
  const visibleEvents = events.slice(-RECENT_SESSION_LIMIT);
  const hiddenCount = Math.max(0, events.length - visibleEvents.length);
  const scrollKey = `${latestEvent?.eventId || ''}:${latestEvent?.content || ''}:${events.length}`;
  useAutoScrollToBottom(scrollRef, scrollKey);

  return (
    <div className="rounded-lg border border-border-color bg-black/20 p-3">
      <SessionTailHeader
        events={events}
        latestEvent={latestEvent}
        nowMs={nowMs}
      />
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
        <SessionEventList events={visibleEvents} scrollRef={scrollRef} />
      )}
    </div>
  );
}

export function TaskSessionTailView({
  snapshot,
  nowMs = Date.now(),
}: {
  snapshot: TaskPlanningSnapshot;
  nowMs?: number;
}) {
  const sessionEvents = sortSessionEvents(snapshot.agentSessionEvents || []);
  const runningRun = getLatestRunningRun(snapshot.agentRuns || []);

  return (
    <SessionTail events={sessionEvents} runningRun={runningRun} nowMs={nowMs} />
  );
}
