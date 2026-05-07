import type { TaskPlanningSnapshot } from '../types';
import type {
  ApproveTaskPlanResponse,
  CompleteTaskResponse,
  DeliveryRunResponse,
  DraftTaskInput,
  ImplementationRunResponse,
  PlannerRunResponse,
  RepositoryOption,
} from './api';

export type SimpleActionResponse =
  | ApproveTaskPlanResponse
  | PlannerRunResponse
  | ImplementationRunResponse
  | DeliveryRunResponse
  | CompleteTaskResponse;

export interface UseTaskPlanningActionsInput {
  selected: TaskPlanningSnapshot | null;
  selectedRepository?: RepositoryOption;
  draft: DraftTaskInput;
  messageBody: string;
  messageAttachments: File[];
  busyAction: string | null;
  repositoriesRefreshing: boolean;
  canApprove: boolean;
  canImplement: boolean;
  canDeliver: boolean;
  setDraft: React.Dispatch<React.SetStateAction<DraftTaskInput>>;
  setTasks: React.Dispatch<React.SetStateAction<TaskPlanningSnapshot[]>>;
  setSelectedTaskId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsNewTaskOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedSnapshot: React.Dispatch<
    React.SetStateAction<TaskPlanningSnapshot | null>
  >;
  setMessageBody: React.Dispatch<React.SetStateAction<string>>;
  setMessageAttachments: React.Dispatch<React.SetStateAction<File[]>>;
  setBusyAction: React.Dispatch<React.SetStateAction<string | null>>;
  setRepositoriesRefreshing: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  loadRepositories: () => Promise<void>;
  loadSelectedTask: (taskId: string) => Promise<void>;
}
