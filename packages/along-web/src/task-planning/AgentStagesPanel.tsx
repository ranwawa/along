import type {
  TaskAgentManualResume,
  TaskAgentRunRecord,
  TaskAgentStageRecord,
} from '../types';
import {
  formatDuration,
  formatTime,
  getStageStatusClass,
  getStageStatusLabel,
} from './format';

function AgentStageItem({ stage }: { stage: TaskAgentStageRecord }) {
  const run = stage.latestRun;
  const showManualActions = stage.status === 'failed';

  return (
    <div className="rounded-lg border border-border-color bg-black/25 p-3">
      <AgentStageHeader stage={stage} run={run} />
      {run && <AgentStageRunDetails run={run} />}
      {run?.error && <AgentStageError error={run.error} />}
      {showManualActions && (
        <AgentStageManualActions manualResume={stage.manualResume} />
      )}
    </div>
  );
}

function AgentStageHeader({
  stage,
  run,
}: {
  stage: TaskAgentStageRecord;
  run?: TaskAgentRunRecord;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-text-secondary">
          {stage.label}
        </div>
        <div className="text-xs text-text-muted mt-1">
          {run
            ? `${run.provider} / ${run.agentId} / ${formatDuration(
                run.startedAt,
                run.endedAt,
              )}`
            : stage.agentId}
        </div>
      </div>
      <span
        className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${getStageStatusClass(
          stage.status,
        )}`}
      >
        {getStageStatusLabel(stage.status)}
      </span>
    </div>
  );
}

function AgentStageRunDetails({ run }: { run: TaskAgentRunRecord }) {
  return (
    <div className="mt-3 grid grid-cols-[72px_1fr] gap-x-3 gap-y-1 text-xs">
      <span className="text-text-muted">开始</span>
      <span>{formatTime(run.startedAt)}</span>
      {run.endedAt && (
        <>
          <span className="text-text-muted">结束</span>
          <span>{formatTime(run.endedAt)}</span>
        </>
      )}
      <span className="text-text-muted">Run</span>
      <span className="truncate" title={run.runId}>
        {run.runId}
      </span>
      <AgentStageSession run={run} />
    </div>
  );
}

function AgentStageSession({ run }: { run: TaskAgentRunRecord }) {
  const sessionId = run.providerSessionIdAtEnd || run.providerSessionIdAtStart;
  if (!sessionId) return null;
  return (
    <>
      <span className="text-text-muted">Session</span>
      <span className="truncate" title={sessionId}>
        {sessionId}
      </span>
    </>
  );
}

function AgentStageError({ error }: { error: string }) {
  return (
    <div className="mt-3 rounded-md border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-200 whitespace-pre-wrap break-words">
      {error}
    </div>
  );
}

function AgentStageManualActions({
  manualResume,
}: {
  manualResume?: TaskAgentManualResume;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      {manualResume?.command ? (
        <pre className="rounded-md border border-border-color bg-black/40 px-3 py-2 text-xs leading-5 text-text-secondary overflow-x-auto whitespace-pre-wrap break-words">
          {manualResume.command}
        </pre>
      ) : (
        <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-200">
          {manualResume?.reason || '当前阶段没有可恢复命令'}
        </div>
      )}
      {manualResume?.reason && manualResume.command && (
        <div className="text-xs text-text-muted">{manualResume.reason}</div>
      )}
      <div className="text-xs text-text-muted">
        接管和人工标记请在当前状态悬浮区域操作。
      </div>
    </div>
  );
}

export function AgentStagesPanel({
  stages,
}: {
  stages: TaskAgentStageRecord[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-secondary">
          Agent 阶段
        </h3>
        <span className="text-xs text-text-muted">
          {stages.filter((stage) => stage.status !== 'idle').length}/
          {stages.length}
        </span>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        {stages.map((stage) => (
          <AgentStageItem key={stage.stage} stage={stage} />
        ))}
      </div>
    </section>
  );
}
