import type {
  TaskExecutionMode,
  TaskPlanningSnapshot,
  TaskRuntimeExecutionMode,
} from '../types';
import type {
  ApproveTaskPlanResponse,
  CloseTaskResponse,
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
  | CompleteTaskResponse
  | CloseTaskResponse;

export interface UseTaskPlanningActionsInput {
  selected: TaskPlanningSnapshot | null;
  selectedRepository?: RepositoryOption;
  draft: DraftTaskInput;
  messageBody: string;
  messageAttachments: File[];
  messageExecutionMode: TaskExecutionMode;
  messageRuntimeExecutionMode: TaskRuntimeExecutionMode;
  busyAction: string | null;
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
  setMessageExecutionMode: React.Dispatch<
    React.SetStateAction<TaskExecutionMode>
  >;
  setMessageRuntimeExecutionMode: React.Dispatch<
    React.SetStateAction<TaskRuntimeExecutionMode>
  >;
  setBusyAction: React.Dispatch<React.SetStateAction<string | null>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  loadSelectedTask: (taskId: string) => Promise<void>;
}
