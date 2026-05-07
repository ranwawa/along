import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { TaskPlanningSnapshot } from '../types';
import {
  type DraftTaskInput,
  emptyDraft,
  mergeSnapshotIntoList,
  type RepositoryListResponse,
  type RepositoryOption,
  readJsonResponse,
  sortTaskSnapshotsBySeqDesc,
} from './api';

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useTaskState() {
  const [tasks, setTasks] = useState<TaskPlanningSnapshot[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] =
    useState<TaskPlanningSnapshot | null>(null);
  const selected = isNewTaskOpen
    ? null
    : selectedSnapshot ||
      tasks.find((snapshot) => snapshot.task.taskId === selectedTaskId) ||
      null;
  return {
    tasks,
    setTasks,
    selected,
    selectedTaskId,
    setSelectedTaskId,
    isNewTaskOpen,
    setIsNewTaskOpen,
    selectedSnapshot,
    setSelectedSnapshot,
  };
}

export function useRepositories() {
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

export type TaskLoaderInput = {
  selectedTaskId: string | null;
  isNewTaskOpen: boolean;
  selectedRepository?: RepositoryOption;
  setTasks: Dispatch<SetStateAction<TaskPlanningSnapshot[]>>;
  setSelectedTaskId: Dispatch<SetStateAction<string | null>>;
  setSelectedSnapshot: Dispatch<SetStateAction<TaskPlanningSnapshot | null>>;
};

export function useTaskLoaders(input: TaskLoaderInput) {
  return {
    loadTasks: useLoadTasks(input),
    loadSelectedTask: useLoadSelectedTask(input),
  };
}

function useLoadTasks(input: TaskLoaderInput) {
  const state = useLoadTaskState(input);
  return useCallback(() => loadTasksForState(state), [state]);
}

function useLoadTaskState(input: TaskLoaderInput) {
  const {
    isNewTaskOpen,
    selectedRepository,
    selectedTaskId,
    setSelectedSnapshot,
    setSelectedTaskId,
    setTasks,
  } = input;
  return useMemo(
    () => ({
      isNewTaskOpen,
      selectedRepository,
      selectedTaskId,
      setSelectedSnapshot,
      setSelectedTaskId,
      setTasks,
    }),
    [
      isNewTaskOpen,
      selectedRepository,
      selectedTaskId,
      setSelectedSnapshot,
      setSelectedTaskId,
      setTasks,
    ],
  );
}

async function loadTasksForState(input: TaskLoaderInput) {
  if (!input.selectedRepository) {
    input.setTasks([]);
    input.setSelectedTaskId(null);
    input.setSelectedSnapshot(null);
    return;
  }
  const params = new URLSearchParams({
    limit: '100',
    owner: input.selectedRepository.owner,
    repo: input.selectedRepository.repo,
  });
  const response = await fetch(`/api/tasks?${params.toString()}`);
  const snapshots = await readJsonResponse<TaskPlanningSnapshot[]>(response);
  const sortedSnapshots = sortTaskSnapshotsBySeqDesc(snapshots);
  input.setTasks(sortedSnapshots);
  updateSelectedTaskAfterLoad(input, sortedSnapshots);
}

function updateSelectedTaskAfterLoad(
  input: TaskLoaderInput,
  snapshots: TaskPlanningSnapshot[],
) {
  const selectedStillVisible = snapshots.some(
    (snapshot) => snapshot.task.taskId === input.selectedTaskId,
  );
  if (input.selectedTaskId && !selectedStillVisible) {
    input.setSelectedTaskId(null);
    input.setSelectedSnapshot(null);
  }
  if (!input.selectedTaskId && !input.isNewTaskOpen && snapshots.length > 0) {
    input.setSelectedTaskId(snapshots[0].task.taskId);
    input.setSelectedSnapshot(snapshots[0]);
  }
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

export function useInitialRepositories(
  loadRepositories: () => Promise<void>,
  setError: (value: string) => void,
) {
  useEffect(() => {
    loadRepositories().catch((err: unknown) => setError(getErrorMessage(err)));
  }, [loadRepositories, setError]);
}

export function useTaskPolling(
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

export function useSelectedTaskPolling(
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
