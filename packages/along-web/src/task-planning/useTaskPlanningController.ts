import { useCallback, useMemo, useState } from 'react';
import type { TaskFlowActionId, TaskPlanningSnapshot } from '../types';
import type { RepositoryOption } from './api';
import { useTaskPlanningActions } from './useTaskPlanningActions';
import {
  useInitialRepositories,
  useRepositories,
  useSelectedTaskPolling,
  useTaskLoaders,
  useTaskPolling,
  useTaskState,
} from './useTaskPlanningState';

export function getFlowFlags(getAction: (id: TaskFlowActionId) => unknown) {
  return {
    canApprove: Boolean(getAction('approve_plan')),
    canImplement: Boolean(
      getAction('start_implementation') ||
        getAction('confirm_implementation_steps'),
    ),
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
  const selectedRepository = findSelectedRepository(
    base.repositoryState.repositories,
    base.repositoryState.draft.repository,
  );
  const loaders = useTaskLoaders({
    selectedTaskId: base.taskState.selectedTaskId,
    isNewTaskOpen: base.taskState.isNewTaskOpen,
    selectedRepository,
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
    setIsNewTaskOpen: base.taskState.setIsNewTaskOpen,
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
