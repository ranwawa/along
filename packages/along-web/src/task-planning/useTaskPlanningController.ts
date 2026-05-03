import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TaskFlowActionId, TaskPlanningSnapshot } from '../types';
import {
  type DraftTaskInput,
  emptyDraft,
  mergeSnapshotIntoList,
  type RepositoryListResponse,
  type RepositoryOption,
  readJsonResponse,
} from './api';
import { useTaskPlanningActions } from './useTaskPlanningActions';

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function useTaskState() {
  const [tasks, setTasks] = useState<TaskPlanningSnapshot[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] =
    useState<TaskPlanningSnapshot | null>(null);
  const selected =
    selectedSnapshot ||
    tasks.find((snapshot) => snapshot.task.taskId === selectedTaskId) ||
    null;
  return {
    tasks,
    setTasks,
    selected,
    selectedTaskId,
    setSelectedTaskId,
    selectedSnapshot,
    setSelectedSnapshot,
  };
}

function useRepositories() {
  const [repositories, setRepositories] = useState<RepositoryOption[]>([]);
  const [draft, setDraft] = useState<DraftTaskInput>(emptyDraft);
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
  return { repositories, setRepositories, draft, setDraft, loadRepositories };
}

type TaskLoaderInput = {
  selectedTaskId: string | null;
  setTasks: React.Dispatch<React.SetStateAction<TaskPlanningSnapshot[]>>;
  setSelectedTaskId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedSnapshot: React.Dispatch<
    React.SetStateAction<TaskPlanningSnapshot | null>
  >;
};

function useTaskLoaders(input: TaskLoaderInput) {
  return {
    loadTasks: useLoadTasks(input),
    loadSelectedTask: useLoadSelectedTask(input),
  };
}

function useLoadTasks(input: TaskLoaderInput) {
  const loadTasks = useCallback(async () => {
    const response = await fetch('/api/tasks?limit=100');
    const snapshots = await readJsonResponse<TaskPlanningSnapshot[]>(response);
    input.setTasks(snapshots);
    if (!input.selectedTaskId && snapshots.length > 0) {
      input.setSelectedTaskId(snapshots[0].task.taskId);
      input.setSelectedSnapshot(snapshots[0]);
    }
  }, [
    input.selectedTaskId,
    input.setSelectedSnapshot,
    input.setSelectedTaskId,
    input.setTasks,
  ]);
  return loadTasks;
}

function useLoadSelectedTask(input: TaskLoaderInput) {
  const loadSelectedTask = useCallback(
    async (taskId: string) => {
      const response = await fetch(`/api/tasks/${taskId}`);
      const snapshot = await readJsonResponse<TaskPlanningSnapshot>(response);
      input.setSelectedSnapshot(snapshot);
      input.setTasks((previous) => mergeSnapshotIntoList(previous, snapshot));
    },
    [input.setSelectedSnapshot, input.setTasks],
  );
  return loadSelectedTask;
}

function useInitialRepositories(
  loadRepositories: () => Promise<void>,
  setError: (value: string) => void,
) {
  useEffect(() => {
    loadRepositories().catch((err: unknown) => setError(getErrorMessage(err)));
  }, [loadRepositories, setError]);
}

function useTaskPolling(
  loadTasks: () => Promise<void>,
  setError: (value: string) => void,
) {
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    loadTasks()
      .catch((err: unknown) => active && setError(getErrorMessage(err)))
      .finally(() => active && setLoading(false));
    const timer = setInterval(() => {
      loadTasks().catch((err: unknown) => setError(getErrorMessage(err)));
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [loadTasks, setError]);
  return loading;
}

function useSelectedTaskPolling(
  selectedTaskId: string | null,
  loadSelectedTask: (taskId: string) => Promise<void>,
  setError: (value: string) => void,
) {
  useEffect(() => {
    if (!selectedTaskId) return;
    let active = true;
    const refresh = () =>
      loadSelectedTask(selectedTaskId).catch((err: unknown) => {
        if (active) setError(getErrorMessage(err));
      });
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedTaskId, loadSelectedTask, setError]);
}

function getFlowFlags(getAction: (id: TaskFlowActionId) => unknown) {
  return {
    canApprove: Boolean(getAction('approve_plan')),
    canImplement: Boolean(getAction('start_implementation')),
    canDeliver: Boolean(getAction('start_delivery')),
  };
}

function usePlanningBaseState() {
  const taskState = useTaskState();
  const repositoryState = useRepositories();
  const [messageBody, setMessageBody] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [repositoriesRefreshing, setRepositoriesRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    taskState,
    repositoryState,
    messageBody,
    setMessageBody,
    busyAction,
    setBusyAction,
    repositoriesRefreshing,
    setRepositoriesRefreshing,
    error,
    setError,
  };
}

function useTaskDerivedData(
  taskState: ReturnType<typeof useTaskState>,
  repositoryState: ReturnType<typeof useRepositories>,
) {
  const selectedRepository = useMemo(
    () =>
      findSelectedRepository(
        repositoryState.repositories,
        repositoryState.draft.repository,
      ),
    [repositoryState.draft.repository, repositoryState.repositories],
  );
  const sortedArtifacts = useMemo(
    () => sortArtifacts(taskState.selected),
    [taskState.selected],
  );
  const getAction = useCallback(
    (id: TaskFlowActionId) =>
      taskState.selected?.flow.actions.find((action) => action.id === id)
        ?.enabled,
    [taskState.selected],
  );
  return { selectedRepository, sortedArtifacts, getAction };
}

function findSelectedRepository(
  repositories: RepositoryOption[],
  repositoryName: string,
) {
  return repositories.find((repo) => repo.fullName === repositoryName);
}

function sortArtifacts(selected: TaskPlanningSnapshot | null) {
  if (!selected) return [];
  return [...selected.artifacts].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function usePlanningLoaders(base: ReturnType<typeof usePlanningBaseState>) {
  const loaders = useTaskLoaders({
    selectedTaskId: base.taskState.selectedTaskId,
    setTasks: base.taskState.setTasks,
    setSelectedTaskId: base.taskState.setSelectedTaskId,
    setSelectedSnapshot: base.taskState.setSelectedSnapshot,
  });
  const setErrorMessage = useCallback(
    (value: string) => base.setError(value),
    [base.setError],
  );
  useInitialRepositories(
    base.repositoryState.loadRepositories,
    setErrorMessage,
  );
  const loading = useTaskPolling(loaders.loadTasks, setErrorMessage);
  useSelectedTaskPolling(
    base.taskState.selectedTaskId,
    loaders.loadSelectedTask,
    setErrorMessage,
  );
  return { loaders, loading };
}

function usePlanningActions(
  base: ReturnType<typeof usePlanningBaseState>,
  derived: ReturnType<typeof useTaskDerivedData>,
  loaders: ReturnType<typeof useTaskLoaders>,
) {
  const flowFlags = getFlowFlags(derived.getAction);
  const actions = useTaskPlanningActions({
    selected: base.taskState.selected,
    selectedRepository: derived.selectedRepository,
    draft: base.repositoryState.draft,
    messageBody: base.messageBody,
    busyAction: base.busyAction,
    repositoriesRefreshing: base.repositoriesRefreshing,
    ...flowFlags,
    setDraft: base.repositoryState.setDraft,
    setTasks: base.taskState.setTasks,
    setSelectedTaskId: base.taskState.setSelectedTaskId,
    setSelectedSnapshot: base.taskState.setSelectedSnapshot,
    setMessageBody: base.setMessageBody,
    setBusyAction: base.setBusyAction,
    setRepositoriesRefreshing: base.setRepositoriesRefreshing,
    setError: base.setError,
    loadRepositories: base.repositoryState.loadRepositories,
    loadSelectedTask: loaders.loadSelectedTask,
  });
  return actions;
}

export function useTaskPlanningController() {
  const base = usePlanningBaseState();
  const loadState = usePlanningLoaders(base);
  const derived = useTaskDerivedData(base.taskState, base.repositoryState);
  const actions = usePlanningActions(base, derived, loadState.loaders);
  return {
    ...base.taskState,
    ...base.repositoryState,
    ...derived,
    messageBody: base.messageBody,
    loading: loadState.loading,
    busyAction: base.busyAction,
    repositoriesRefreshing: base.repositoriesRefreshing,
    error: base.error,
    setMessageBody: base.setMessageBody,
    ...actions,
  };
}
