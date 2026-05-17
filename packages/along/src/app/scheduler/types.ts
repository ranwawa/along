import type {
  TaskPlanningSnapshot,
  TaskRuntimeExecutionMode,
} from '../planning';

export interface ScheduledTaskPlanningRun {
  taskId: string;
  cwd: string;
  reason: 'task_created' | 'user_message' | 'manual' | 'autonomous';
  agentId?: string;
  modelId?: string;
  personalityVersion?: string;
  runtimeExecutionMode?: TaskRuntimeExecutionMode;
}

export interface ScheduledTaskExecRun {
  taskId: string;
  cwd: string;
  reason: 'manual' | 'autonomous';
  agentId?: string;
  modelId?: string;
  personalityVersion?: string;
}

export interface ScheduledTaskDeliveryRun {
  taskId: string;
  cwd: string;
  reason: 'manual' | 'autonomous';
}

export interface ScheduledTaskTitleSummaryRun {
  taskId: string;
  body: string;
  attachmentCount?: number;
}

export interface TaskApiSchedulerContext {
  defaultCwd: string;
  schedulePlanner?: (input: ScheduledTaskPlanningRun) => void;
  scheduleExec?: (input: ScheduledTaskExecRun) => void;
  scheduleDelivery?: (input: ScheduledTaskDeliveryRun) => void;
  scheduleTitleSummary?: (input: ScheduledTaskTitleSummaryRun) => void;
  resolveRepoPath?: (owner: string, repo: string) => string | undefined;
  resolveRepositoryForPath?: (
    cwd: string,
  ) => Pick<TaskPlanningSnapshot['task'], 'repoOwner' | 'repoName'> | undefined;
}
