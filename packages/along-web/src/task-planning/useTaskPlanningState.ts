import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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

export const LAST_TASK_REPOSITORY_KEY = 'along-web:last-task-repository';
const TASK_POLLING_INTERVAL_MS = 3000;

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function readLastRepository() {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(LAST_TASK_REPOSITORY_KEY) || '';
  } catch {
    return '';
  }
}

export function writeLastRepository(repository: string) {
  if (!repository || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_TASK_REPOSITORY_KEY, repository);
  } catch {
    // localStorage can be disabled; selection still works for the current page.
  }
}

function isKnownRepository(
  repository: string,
  repositories: RepositoryOption[],
) {
  return repositories.some((option) => option.fullName === repository);
}

export function resolveInitialRepository(
  repositories: RepositoryOption[],
  defaultRepository?: string,
  cachedRepository = readLastRepository(),
) {
  const repositoryNames = new Set(
    repositories.map((repository) => repository.fullName),
  );
  if (cachedRepository && repositoryNames.has(cachedRepository)) {
    return cachedRepository;
  }
  if (defaultRepository && repositoryNames.has(defaultRepository)) {
    return defaultRepository;
  }
  return repositories[0]?.fullName || '';
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
  const repositoriesRef = useRef<RepositoryOption[]>([]);
  const [draft, setDraft] = useState<DraftTaskInput>(emptyDraft);
  const setDraftWithRepositoryCache: Dispatch<SetStateAction<DraftTaskInput>> =
    useCallback((value) => {
      setDraft((previous) => {
        const next = typeof value === 'function' ? value(previous) : value;
        if (isKnownRepository(next.repository, repositoriesRef.current)) {
          writeLastRepository(next.repository);
        }
        return next;
      });
    }, []);
  const loadRepositories = useCallback(async () => {
    const response = await fetch('/api/repositories');
    const result = await readJsonResponse<RepositoryListResponse>(response);
    repositoriesRef.current = result.repositories;
    setRepositories(result.repositories);
    setDraftWithRepositoryCache((previous) => {
      if (previous.repository) return previous;
      return {
        ...previous,
        repository: resolveInitialRepository(
          result.repositories,
          result.defaultRepository,
        ),
      };
    });
  }, [setDraftWithRepositoryCache]);
  return {
    repositories,
    setRepositories,
    draft,
    setDraft: setDraftWithRepositoryCache,
    loadRepositories,
  };
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
    }, TASK_POLLING_INTERVAL_MS);
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
    const timer = setInterval(refresh, TASK_POLLING_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedTaskId, loadSelectedTask, setError]);
}
