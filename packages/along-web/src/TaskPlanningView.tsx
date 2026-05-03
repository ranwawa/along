import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  TaskArtifactRecord,
  TaskArtifactType,
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
    default:
      return status;
  }
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

  const canApprove = Boolean(
    selected?.currentPlan &&
      !selected.openRound &&
      selected.thread.status !== 'approved',
  );
  const canImplement = Boolean(
    selected?.thread.approvedPlanId &&
      selected.task.status === 'planning_approved',
  );
  const canDeliver = selected?.task.status === 'implemented';
  const canReply = selected?.thread.status !== 'approved';

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

  const submitMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || busyAction) return;
    const body = messageBody.trim();
    if (!body) return;

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
            tasks.map((snapshot) => (
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
                  <TaskStatusBadge snapshot={snapshot} />
                  <span className="text-[11px] text-text-muted shrink-0">
                    {formatTime(snapshot.task.updatedAt)}
                  </span>
                </div>
                <div className="font-medium text-sm truncate">
                  {snapshot.task.title}
                </div>
                <div className="text-xs text-text-muted truncate mt-1">
                  {snapshot.task.body}
                </div>
              </button>
            ))
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
                    <span className="text-xs text-text-muted">
                      v{selected.currentPlan?.version || 0}
                    </span>
                  </div>
                  <h2 className="text-lg md:text-xl font-semibold truncate">
                    {selected.task.title}
                  </h2>
                </div>
                <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                  <button
                    type="button"
                    onClick={rerunPlanner}
                    disabled={Boolean(busyAction)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border-color text-text-secondary hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {busyAction === 'planner' ? '排队中' : '重新规划'}
                  </button>
                  <button
                    type="button"
                    onClick={approvePlan}
                    disabled={!canApprove || Boolean(busyAction)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-500/30 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {busyAction === 'approve' ? '处理中' : '批准方案'}
                  </button>
                  <button
                    type="button"
                    onClick={startImplementation}
                    disabled={!canImplement || Boolean(busyAction)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-cyan-500/30 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {busyAction === 'implementation' ? '排队中' : '开始实现'}
                  </button>
                  <button
                    type="button"
                    onClick={startDelivery}
                    disabled={!canDeliver || Boolean(busyAction)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-violet-500/30 bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {busyAction === 'delivery' ? '排队中' : '提交并创建 PR'}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto p-4 md:p-6 grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
              <div className="min-w-0 flex flex-col gap-5">
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
                <form
                  onSubmit={submitMessage}
                  className="rounded-lg border border-border-color bg-black/25 p-4 flex flex-col gap-3"
                >
                  <div className="font-semibold text-sm text-text-secondary">
                    继续讨论
                  </div>
                  <textarea
                    value={messageBody}
                    onChange={(event) => setMessageBody(event.target.value)}
                    placeholder="继续澄清或反馈"
                    rows={8}
                    disabled={!canReply}
                    className="bg-black/35 border border-border-color rounded-lg px-3 py-2 text-sm outline-none resize-none focus:ring-1 focus:ring-brand/60 disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={
                      !messageBody.trim() || !canReply || Boolean(busyAction)
                    }
                    className="px-3 py-2 rounded-lg text-sm font-semibold bg-brand text-white border border-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {busyAction === 'message' ? '发送中' : '发送'}
                  </button>
                </form>

                <div className="rounded-lg border border-border-color bg-black/25 p-4 flex flex-col gap-3">
                  <div className="font-semibold text-sm text-text-secondary">
                    任务信息
                  </div>
                  <div className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-2 text-sm">
                    <span className="text-text-muted">ID</span>
                    <span className="truncate">{selected.task.taskId}</span>
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
