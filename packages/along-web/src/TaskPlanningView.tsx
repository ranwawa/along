import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  TaskAgentStageRecord,
  TaskAgentStageStatus,
  TaskArtifactRecord,
  TaskArtifactType,
  TaskFlowAction,
  TaskFlowActionId,
  TaskFlowSnapshot,
  TaskFlowStage,
  TaskFlowStageState,
  TaskPlanningSnapshot,
  TaskThreadStatus,
} from './types';

interface TaskApiError {
  error?: string;
}

interface CreateTaskResponse {
  taskId: string;
  scheduled: boolean;
  snapshot: TaskPlanningSnapshot;
}

interface SubmitTaskMessageResponse {
  taskId: string;
  scheduled: boolean;
  snapshot: TaskPlanningSnapshot | null;
}

interface ApproveTaskPlanResponse {
  taskId: string;
  snapshot: TaskPlanningSnapshot | null;
}

interface PlannerRunResponse {
  taskId: string;
  scheduled: boolean;
}

interface ImplementationRunResponse {
  taskId: string;
  scheduled: boolean;
}

interface DeliveryRunResponse {
  taskId: string;
  scheduled: boolean;
}

interface ManualCompleteResponse {
  taskId: string;
  snapshot: TaskPlanningSnapshot;
}

interface CompleteTaskResponse {
  taskId: string;
  snapshot: TaskPlanningSnapshot;
}

interface RepositoryOption {
  owner: string;
  repo: string;
  fullName: string;
  path: string;
  isDefault: boolean;
}

interface RepositoryListResponse {
  repositories: RepositoryOption[];
  defaultRepository?: string;
}

interface DraftTaskInput {
  title: string;
  body: string;
  repository: string;
}

const emptyDraft: DraftTaskInput = {
  title: '',
  body: '',
  repository: '',
};

function mergeSnapshotIntoList(
  previous: TaskPlanningSnapshot[],
  snapshot: TaskPlanningSnapshot,
): TaskPlanningSnapshot[] {
  const next = previous.filter(
    (item) => item.task.taskId !== snapshot.task.taskId,
  );
  return [snapshot, ...next].sort((left, right) =>
    right.task.updatedAt.localeCompare(left.task.updatedAt),
  );
}

function isTaskApiError(value: unknown): value is TaskApiError {
  return value !== null && typeof value === 'object' && 'error' in value;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      isTaskApiError(payload) && typeof payload.error === 'string'
        ? payload.error
        : `请求失败: ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDuration(startedAt: string, endedAt?: string): string {
  const started = new Date(startedAt).getTime();
  const ended = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (Number.isNaN(started) || Number.isNaN(ended) || ended < started) {
    return '-';
  }

  const totalSeconds = Math.max(1, Math.round((ended - started) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function getThreadStatusLabel(status: TaskThreadStatus): string {
  switch (status) {
    case 'drafting':
      return '起草中';
    case 'awaiting_approval':
      return '待批准';
    case 'discussing':
      return '讨论中';
    case 'approved':
      return '已批准';
    default:
      return status;
  }
}

function getTaskStatusLabel(status: string): string {
  switch (status) {
    case 'planning':
      return '规划中';
    case 'planning_approved':
      return '方案已批准';
    case 'implementing':
      return '实现中';
    case 'implemented':
      return '已实现';
    case 'delivering':
      return '交付中';
    case 'delivered':
      return '已交付';
    case 'completed':
      return '已完成';
    default:
      return status;
  }
}

function getStageStatusLabel(status: TaskAgentStageStatus): string {
  switch (status) {
    case 'idle':
      return '未运行';
    case 'running':
      return '运行中';
    case 'succeeded':
      return '已完成';
    case 'failed':
      return '失败';
    default:
      return status;
  }
}

function getStageStatusClass(status: TaskAgentStageStatus): string {
  switch (status) {
    case 'running':
      return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
    case 'succeeded':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'failed':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    default:
      return 'bg-white/5 text-text-muted border-border-color';
  }
}

function getLatestFailedStage(
  snapshot: TaskPlanningSnapshot,
): TaskAgentStageRecord | null {
  const failedStages = (snapshot.agentStages || []).filter(
    (stage) => stage.status === 'failed' && stage.latestRun,
  );
  return (
    failedStages.sort((left, right) =>
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

function getThreadStatusClass(status: TaskThreadStatus): string {
  switch (status) {
    case 'drafting':
      return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
    case 'awaiting_approval':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'discussing':
      return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
    case 'approved':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    default:
      return 'bg-white/10 text-text-secondary border-border-color';
  }
}

function getArtifactLabel(type: TaskArtifactType): string {
  switch (type) {
    case 'user_message':
      return '用户';
    case 'plan_revision':
      return '计划';
    case 'planning_update':
      return '更新';
    case 'approval':
      return '批准';
    case 'agent_result':
      return 'Agent';
    default:
      return type;
  }
}

function getArtifactClass(type: TaskArtifactType): string {
  switch (type) {
    case 'user_message':
      return 'border-emerald-500/20 bg-emerald-500/10';
    case 'plan_revision':
      return 'border-amber-500/20 bg-amber-500/10';
    case 'planning_update':
      return 'border-cyan-500/20 bg-cyan-500/10';
    case 'approval':
      return 'border-emerald-500/25 bg-emerald-500/15';
    case 'agent_result':
      return 'border-white/10 bg-white/5';
    default:
      return 'border-border-color bg-white/5';
  }
}

function TaskStatusBadge({ snapshot }: { snapshot: TaskPlanningSnapshot }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${getThreadStatusClass(
        snapshot.thread.status,
      )}`}
    >
      {getThreadStatusLabel(snapshot.thread.status)}
    </span>
  );
}

function ArtifactItem({ artifact }: { artifact: TaskArtifactRecord }) {
  return (
    <div className={`rounded-lg border p-3 ${getArtifactClass(artifact.type)}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-xs font-semibold text-text-secondary">
          {getArtifactLabel(artifact.type)}
        </span>
        <span className="text-[11px] text-text-muted shrink-0">
          {formatTime(artifact.createdAt)}
        </span>
      </div>
      <div className="text-sm whitespace-pre-wrap break-words leading-6">
        {artifact.body}
      </div>
    </div>
  );
}

function AgentStageItem({ stage }: { stage: TaskAgentStageRecord }) {
  const run = stage.latestRun;
  const manualResume = stage.manualResume;
  const showManualActions = stage.status === 'failed';

  return (
    <div className="rounded-lg border border-border-color bg-black/25 p-3">
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

      {run && (
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
          {(run.providerSessionIdAtEnd || run.providerSessionIdAtStart) && (
            <>
              <span className="text-text-muted">Session</span>
              <span
                className="truncate"
                title={
                  run.providerSessionIdAtEnd || run.providerSessionIdAtStart
                }
              >
                {run.providerSessionIdAtEnd || run.providerSessionIdAtStart}
              </span>
            </>
          )}
        </div>
      )}

      {run?.error && (
        <div className="mt-3 rounded-md border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-200 whitespace-pre-wrap break-words">
          {run.error}
        </div>
      )}

      {showManualActions && (
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
          <div className="flex flex-wrap gap-2">
            <div className="text-xs text-text-muted">
              接管和人工标记请使用当前节奏中的可执行操作。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentStagesPanel({ stages }: { stages: TaskAgentStageRecord[] }) {
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

function getFlowStageStateClass(state: TaskFlowStageState): string {
  switch (state) {
    case 'completed':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
    case 'current':
      return 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100';
    case 'blocked':
      return 'border-rose-500/40 bg-rose-500/10 text-rose-100';
    case 'attention':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-100';
    default:
      return 'border-border-color bg-black/20 text-text-muted';
  }
}

function getFlowStageDotClass(state: TaskFlowStageState): string {
  switch (state) {
    case 'completed':
      return 'bg-emerald-400';
    case 'current':
      return 'bg-cyan-400';
    case 'blocked':
      return 'bg-rose-400';
    case 'attention':
      return 'bg-amber-400';
    default:
      return 'bg-text-muted';
  }
}

function getFlowSeverityClass(severity: TaskFlowSnapshot['severity']): string {
  switch (severity) {
    case 'success':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100';
    case 'warning':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-100';
    case 'blocked':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-100';
    default:
      return 'border-cyan-500/25 bg-cyan-500/10 text-cyan-100';
  }
}

function getFlowActionClass(action: TaskFlowAction): string {
  if (action.variant === 'danger') {
    return 'border-rose-500/30 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25';
  }
  if (action.variant === 'primary') {
    return 'border-brand bg-brand text-white hover:bg-brand-hover';
  }
  return 'border-border-color text-text-secondary hover:bg-white/5';
}

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

function TaskFlowPanel({
  flow,
  messageBody,
  busyAction,
  onMessageChange,
  onSubmitMessage,
  onAction,
}: {
  flow: TaskFlowSnapshot;
  messageBody: string;
  busyAction: string | null;
  onMessageChange: (value: string) => void;
  onSubmitMessage: () => void;
  onAction: (action: TaskFlowAction) => void;
}) {
  const submitFeedbackAction = flow.actions.find(
    (action) => action.id === 'submit_feedback',
  );
  const requestRevisionAction = flow.actions.find(
    (action) => action.id === 'request_revision',
  );
  const requestChangesAction = flow.actions.find(
    (action) => action.id === 'request_changes',
  );
  const messageActions = requestChangesAction?.enabled
    ? [requestChangesAction]
    : [submitFeedbackAction, requestRevisionAction].filter(
        (action): action is TaskFlowAction => Boolean(action),
      );
  const commandActions = flow.actions.filter(
    (action) =>
      !['submit_feedback', 'request_revision', 'request_changes'].includes(
        action.id,
      ),
  );
  const canSubmitMessage = messageActions.some((action) => action.enabled);

  return (
    <section className="rounded-lg border border-border-color bg-black/25 p-4 md:p-5 flex flex-col gap-4">
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

      <div className="flex gap-3 overflow-x-auto pb-1">
        {flow.stages.map((stage) => (
          <FlowStageItem key={stage.id} stage={stage} />
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(260px,360px)] gap-4">
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {flow.actions
              .filter((action) => !action.enabled && action.disabledReason)
              .map((action) => (
                <div
                  key={action.id}
                  className="rounded-md border border-border-color bg-black/20 px-3 py-2 text-xs leading-5 text-text-muted"
                >
                  <span className="text-text-secondary">{action.label}</span>
                  ：{action.disabledReason}
                </div>
              ))}
          </div>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmitMessage();
          }}
          className="flex flex-col gap-3"
        >
          <div className="text-sm font-semibold text-text-secondary">
            讨论与修改
          </div>
          <textarea
            value={messageBody}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder="补充反馈、继续提问或说明交付后的修改要求"
            rows={5}
            disabled={!canSubmitMessage}
            className="bg-black/35 border border-border-color rounded-lg px-3 py-2 text-sm outline-none resize-none focus:ring-1 focus:ring-brand/60 disabled:opacity-50"
          />
          <div className="flex flex-wrap gap-2">
            {messageActions.map((action) => (
              <button
                key={action.id}
                type="submit"
                disabled={
                  !action.enabled ||
                  !messageBody.trim() ||
                  Boolean(busyAction)
                }
                title={
                  !action.enabled
                    ? action.disabledReason
                    : !messageBody.trim()
                      ? '先输入内容'
                      : action.description
                }
                className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${getFlowActionClass(
                  action,
                )}`}
              >
                {busyAction === 'message' ? '发送中' : action.label}
              </button>
            ))}
          </div>
        </form>
      </div>

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
    </section>
  );
}

export function TaskPlanningView() {
  const [tasks, setTasks] = useState<TaskPlanningSnapshot[]>([]);
  const [repositories, setRepositories] = useState<RepositoryOption[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] =
    useState<TaskPlanningSnapshot | null>(null);
  const [draft, setDraft] = useState<DraftTaskInput>(emptyDraft);
  const [messageBody, setMessageBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [repositoriesRefreshing, setRepositoriesRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRepositories = useCallback(async () => {
    const response = await fetch('/api/repositories');
    const result = await readJsonResponse<RepositoryListResponse>(response);
    setRepositories(result.repositories);
    setDraft((previous) => {
      if (previous.repository) return previous;
      return {
        ...previous,
        repository:
          result.defaultRepository || result.repositories[0]?.fullName || '',
      };
    });
  }, []);

  const loadTasks = useCallback(async () => {
    const response = await fetch('/api/tasks?limit=100');
    const snapshots = await readJsonResponse<TaskPlanningSnapshot[]>(response);
    setTasks(snapshots);
    if (!selectedTaskId && snapshots.length > 0) {
      setSelectedTaskId(snapshots[0].task.taskId);
      setSelectedSnapshot(snapshots[0]);
    }
  }, [selectedTaskId]);

  const loadSelectedTask = useCallback(async (taskId: string) => {
    const response = await fetch(`/api/tasks/${taskId}`);
    const snapshot = await readJsonResponse<TaskPlanningSnapshot>(response);
    setSelectedSnapshot(snapshot);
    setTasks((previous) => {
      const next = previous.filter((item) => item.task.taskId !== taskId);
      return [snapshot, ...next].sort((left, right) =>
        right.task.updatedAt.localeCompare(left.task.updatedAt),
      );
    });
  }, []);

  useEffect(() => {
    loadRepositories().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [loadRepositories]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadTasks()
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const timer = setInterval(() => {
      loadTasks().catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    }, 3000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [loadTasks]);

  useEffect(() => {
    if (!selectedTaskId) return;
    let active = true;

    const refresh = () => {
      loadSelectedTask(selectedTaskId).catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    };

    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedTaskId, loadSelectedTask]);

  const selected =
    selectedSnapshot ||
    tasks.find((snapshot) => snapshot.task.taskId === selectedTaskId) ||
    null;

  const sortedArtifacts = useMemo(() => {
    return selected
      ? [...selected.artifacts].sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt),
        )
      : [];
  }, [selected]);

  const selectedRepository = useMemo(() => {
    return repositories.find((repo) => repo.fullName === draft.repository);
  }, [draft.repository, repositories]);

  const getSelectedFlowAction = useCallback(
    (id: TaskFlowActionId): TaskFlowAction | undefined => {
      return selected?.flow.actions.find((action) => action.id === id);
    },
    [selected],
  );

  const canApprove = Boolean(
    getSelectedFlowAction('approve_plan')?.enabled,
  );
  const canImplement = Boolean(
    getSelectedFlowAction('start_implementation')?.enabled,
  );
  const canDeliver = Boolean(getSelectedFlowAction('start_delivery')?.enabled);

  const updateDraft = (key: keyof DraftTaskInput, value: string) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
  };

  const refreshRepositories = async () => {
    if (repositoriesRefreshing) return;
    setRepositoriesRefreshing(true);
    setError(null);
    try {
      const response = await fetch('/api/rescan', { method: 'POST' });
      await readJsonResponse<unknown>(response);
      setDraft((previous) => ({ ...previous, repository: '' }));
      await loadRepositories();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRepositoriesRefreshing(false);
    }
  };

  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    const body = draft.body.trim();
    if (!body || busyAction) return;

    setBusyAction('create');
    setError(null);
    try {
      const payload: Record<string, string | boolean> = {
        body,
        autoRun: true,
      };
      if (draft.title.trim()) payload.title = draft.title.trim();
      if (selectedRepository) {
        payload.owner = selectedRepository.owner;
        payload.repo = selectedRepository.repo;
      }

      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await readJsonResponse<CreateTaskResponse>(response);
      setDraft(emptyDraft);
      setSelectedTaskId(result.taskId);
      setSelectedSnapshot(result.snapshot);
      setTasks((previous) => mergeSnapshotIntoList(previous, result.snapshot));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const sendTaskMessage = async (body: string) => {
    if (!selected || busyAction) return;

    setBusyAction('message');
    setError(null);
    try {
      const response = await fetch(
        `/api/tasks/${selected.task.taskId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body, autoRun: true }),
        },
      );
      const result =
        await readJsonResponse<SubmitTaskMessageResponse>(response);
      setMessageBody('');
      const snapshot = result.snapshot;
      if (snapshot) {
        setSelectedSnapshot(snapshot);
        setTasks((previous) => mergeSnapshotIntoList(previous, snapshot));
      } else {
        await loadSelectedTask(selected.task.taskId);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const submitMessageFromFlow = async () => {
    const body = messageBody.trim();
    if (!body) return;
    await sendTaskMessage(body);
  };

  const approvePlan = async () => {
    if (!selected || !canApprove || busyAction) return;

    setBusyAction('approve');
    setError(null);
    try {
      const response = await fetch(
        `/api/tasks/${selected.task.taskId}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      const result = await readJsonResponse<ApproveTaskPlanResponse>(response);
      const snapshot = result.snapshot;
      if (snapshot) {
        setSelectedSnapshot(snapshot);
        setTasks((previous) => mergeSnapshotIntoList(previous, snapshot));
      } else {
        await loadSelectedTask(selected.task.taskId);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const rerunPlanner = async () => {
    if (!selected || busyAction) return;

    setBusyAction('planner');
    setError(null);
    try {
      const response = await fetch(
        `/api/tasks/${selected.task.taskId}/planner`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      await readJsonResponse<PlannerRunResponse>(response);
      await loadSelectedTask(selected.task.taskId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const startImplementation = async () => {
    if (!selected || !canImplement || busyAction) return;

    setBusyAction('implementation');
    setError(null);
    try {
      const response = await fetch(
        `/api/tasks/${selected.task.taskId}/implementation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      await readJsonResponse<ImplementationRunResponse>(response);
      await loadSelectedTask(selected.task.taskId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const startDelivery = async () => {
    if (!selected || !canDeliver || busyAction) return;

    setBusyAction('delivery');
    setError(null);
    try {
      const response = await fetch(
        `/api/tasks/${selected.task.taskId}/delivery`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      await readJsonResponse<DeliveryRunResponse>(response);
      await loadSelectedTask(selected.task.taskId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const completeTask = async () => {
    if (!selected || busyAction) return;

    setBusyAction('accept_delivery');
    setError(null);
    try {
      const response = await fetch(
        `/api/tasks/${selected.task.taskId}/complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      const result = await readJsonResponse<CompleteTaskResponse>(response);
      setSelectedSnapshot(result.snapshot);
      setTasks((previous) => mergeSnapshotIntoList(previous, result.snapshot));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const copyManualResumeCommand = async (stage: TaskAgentStageRecord) => {
    const command = stage.manualResume?.command;
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const completeManualStage = async (stage: TaskAgentStageRecord) => {
    if (!selected || busyAction) return;

    const rawMessage = window.prompt(
      `${stage.label}人工处理说明`,
      '已人工接管并处理完成。',
    );
    if (rawMessage === null) return;
    const message = rawMessage.trim() || undefined;
    let prUrl: string | undefined;
    if (stage.stage === 'delivery') {
      prUrl =
        window.prompt('PR URL（如已人工创建 PR，请填写）', '')?.trim() ||
        undefined;
    }

    setBusyAction(`manual-${stage.stage}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/tasks/${selected.task.taskId}/manual-complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stage: stage.stage,
            message,
            prUrl,
          }),
        },
      );
      const result = await readJsonResponse<ManualCompleteResponse>(response);
      setSelectedSnapshot(result.snapshot);
      setTasks((previous) => mergeSnapshotIntoList(previous, result.snapshot));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleFlowAction = (action: TaskFlowAction) => {
    if (!selected || !action.enabled || busyAction) return;
    const failedStage = getLatestFailedStage(selected);

    switch (action.id) {
      case 'approve_plan':
        void approvePlan();
        break;
      case 'rerun_planner':
        void rerunPlanner();
        break;
      case 'start_implementation':
        void startImplementation();
        break;
      case 'copy_resume_command':
        if (failedStage) void copyManualResumeCommand(failedStage);
        break;
      case 'manual_complete':
        if (failedStage) void completeManualStage(failedStage);
        break;
      case 'start_delivery':
        void startDelivery();
        break;
      case 'accept_delivery':
        void completeTask();
        break;
      case 'submit_feedback':
      case 'request_revision':
      case 'request_changes':
        void submitMessageFromFlow();
        break;
      default:
        break;
    }
  };

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] border-t border-border-color overflow-auto xl:overflow-hidden">
      <div className="min-h-[360px] xl:min-h-0 xl:h-full border-b xl:border-b-0 xl:border-r border-border-color flex flex-col bg-bg-glass">
        <form
          onSubmit={createTask}
          className="shrink-0 p-4 md:p-5 border-b border-border-color flex flex-col gap-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="font-semibold text-sm md:text-base">新任务</div>
            <button
              type="submit"
              disabled={!draft.body.trim() || busyAction === 'create'}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand text-white border border-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {busyAction === 'create' ? '处理中' : '发送'}
            </button>
          </div>
          <input
            type="text"
            value={draft.title}
            onChange={(event) => updateDraft('title', event.target.value)}
            placeholder="标题"
            className="bg-black/30 border border-border-color rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand/60"
          />
          <textarea
            value={draft.body}
            onChange={(event) => updateDraft('body', event.target.value)}
            placeholder="输入任务目标或问题"
            rows={5}
            className="bg-black/30 border border-border-color rounded-lg px-3 py-2 text-sm outline-none resize-none focus:ring-1 focus:ring-brand/60"
          />
          <div className="flex gap-2">
            <select
              value={draft.repository}
              onChange={(event) =>
                updateDraft('repository', event.target.value)
              }
              className="min-w-0 flex-1 bg-black/30 border border-border-color rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand/60"
            >
              {repositories.length === 0 ? (
                <option value="">当前默认项目</option>
              ) : (
                repositories.map((repository) => (
                  <option key={repository.fullName} value={repository.fullName}>
                    {repository.fullName}
                    {repository.isDefault ? ' · 默认' : ''}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              onClick={refreshRepositories}
              disabled={repositoriesRefreshing}
              className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold border border-border-color text-text-secondary hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {repositoriesRefreshing ? '刷新中' : '刷新'}
            </button>
          </div>
          {selectedRepository && (
            <div
              className="text-xs text-text-muted truncate"
              title={selectedRepository.path}
            >
              {selectedRepository.path}
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}
        </form>

        <div className="px-4 md:px-5 py-3 border-b border-border-color flex items-center justify-between">
          <span className="text-sm font-semibold">任务列表</span>
          <span className="text-xs text-text-muted">{tasks.length}</span>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {loading && tasks.length === 0 ? (
            <div className="p-5 text-text-muted text-sm">加载中...</div>
          ) : tasks.length === 0 ? (
            <div className="p-5 text-text-muted text-sm">暂无任务。</div>
          ) : (
            tasks.map((snapshot) => {
              const failedStage = getLatestFailedStage(snapshot);
              return (
                <button
                  type="button"
                  key={snapshot.task.taskId}
                  onClick={() => {
                    setSelectedTaskId(snapshot.task.taskId);
                    setSelectedSnapshot(snapshot);
                  }}
                  className={`w-full text-left px-4 md:px-5 py-4 border-b border-white/5 hover:bg-white/5 transition-colors ${
                    selected?.task.taskId === snapshot.task.taskId
                      ? 'bg-white/10'
                      : 'bg-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <TaskStatusBadge snapshot={snapshot} />
                      {failedStage && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border bg-rose-500/15 text-rose-300 border-rose-500/30">
                          {failedStage.label}失败
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-text-muted shrink-0">
                      {formatTime(snapshot.task.updatedAt)}
                    </span>
                  </div>
                  <div className="font-medium text-sm truncate">
                    {snapshot.task.seq != null && (
                      <span className="text-text-muted mr-1">
                        #{snapshot.task.seq}
                      </span>
                    )}
                    {snapshot.task.title}
                  </div>
                  <div className="text-xs text-text-muted truncate mt-1">
                    {failedStage?.latestRun?.error || snapshot.task.body}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="min-h-[560px] xl:min-h-0 flex flex-col bg-bg-secondary">
        {selected ? (
          <>
            <div className="shrink-0 p-4 md:p-6 border-b border-border-color flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <TaskStatusBadge snapshot={selected} />
                    {selected.task.type && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-500/15 text-violet-300 border border-violet-500/30">
                        {selected.task.type}
                      </span>
                    )}
                    <span className="text-xs text-text-muted">
                      v{selected.currentPlan?.version || 0}
                    </span>
                  </div>
                  <h2 className="text-lg md:text-xl font-semibold truncate">
                    {selected.task.seq != null && (
                      <span className="text-text-muted mr-1">#{selected.task.seq}</span>
                    )}
                    {selected.task.title}
                  </h2>
                </div>
                <div className="shrink-0 text-right text-xs text-text-muted">
                  <div>{formatTime(selected.task.updatedAt)}</div>
                  <div>{getTaskStatusLabel(selected.task.status)}</div>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto p-4 md:p-6 grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
              <div className="min-w-0 flex flex-col gap-5">
                <TaskFlowPanel
                  flow={selected.flow}
                  messageBody={messageBody}
                  busyAction={busyAction}
                  onMessageChange={setMessageBody}
                  onSubmitMessage={submitMessageFromFlow}
                  onAction={handleFlowAction}
                />

                <section className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-text-secondary">
                      当前方案
                    </h3>
                    {selected.openRound && (
                      <span className="text-xs text-amber-300">
                        等待重新规划
                      </span>
                    )}
                  </div>
                  <div className="rounded-lg border border-border-color bg-black/35 p-4 min-h-[180px]">
                    {selected.currentPlan ? (
                      <div className="whitespace-pre-wrap break-words text-sm leading-6">
                        {selected.currentPlan.body}
                      </div>
                    ) : (
                      <div className="text-sm text-text-muted">
                        等待 Planner 输出。
                      </div>
                    )}
                  </div>
                </section>

                <AgentStagesPanel stages={selected.agentStages || []} />

                <section className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-text-secondary">
                    过程记录
                  </h3>
                  <div className="flex flex-col gap-3">
                    {sortedArtifacts.length === 0 ? (
                      <div className="text-sm text-text-muted">暂无记录。</div>
                    ) : (
                      sortedArtifacts.map((artifact) => (
                        <ArtifactItem
                          key={artifact.artifactId}
                          artifact={artifact}
                        />
                      ))
                    )}
                  </div>
                </section>
              </div>

              <aside className="min-w-0 flex flex-col gap-4">
                <div className="rounded-lg border border-border-color bg-black/25 p-4 flex flex-col gap-3">
                  <div className="font-semibold text-sm text-text-secondary">
                    任务信息
                  </div>
                  <div className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-2 text-sm">
                    <span className="text-text-muted">ID</span>
                    <span className="truncate">{selected.task.taskId}</span>
                    {selected.task.seq != null && (
                      <>
                        <span className="text-text-muted">Seq</span>
                        <span>#{selected.task.seq}</span>
                      </>
                    )}
                    {selected.task.type && (
                      <>
                        <span className="text-text-muted">Type</span>
                        <span>{selected.task.type}</span>
                      </>
                    )}
                    <span className="text-text-muted">Thread</span>
                    <span className="truncate">{selected.thread.threadId}</span>
                    <span className="text-text-muted">Source</span>
                    <span>{selected.task.source}</span>
                    <span className="text-text-muted">Status</span>
                    <span>{getTaskStatusLabel(selected.task.status)}</span>
                    {selected.task.branchName && (
                      <>
                        <span className="text-text-muted">Branch</span>
                        <span className="truncate">
                          {selected.task.branchName}
                        </span>
                      </>
                    )}
                    {selected.task.worktreePath && (
                      <>
                        <span className="text-text-muted">Worktree</span>
                        <span
                          className="truncate"
                          title={selected.task.worktreePath}
                        >
                          {selected.task.worktreePath}
                        </span>
                      </>
                    )}
                    {selected.task.prUrl && (
                      <>
                        <span className="text-text-muted">PR</span>
                        <a
                          href={selected.task.prUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-brand hover:text-brand-hover"
                        >
                          #{selected.task.prNumber || selected.task.prUrl}
                        </a>
                      </>
                    )}
                    <span className="text-text-muted">Updated</span>
                    <span>{formatTime(selected.task.updatedAt)}</span>
                  </div>
                </div>
              </aside>
            </div>
          </>
        ) : (
          <div className="flex-1 min-h-[320px] flex items-center justify-center text-text-muted text-sm">
            请选择任务。
          </div>
        )}
      </div>
    </div>
  );
}
