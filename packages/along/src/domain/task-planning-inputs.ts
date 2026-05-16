import type { TaskAttachmentUploadInput } from './task-attachments';
import type { TaskAgentRunRecord } from './task-planning-records';
import type {
  AgentRunStatus,
  TaskAgentProgressPhase,
  TaskAgentSessionEventKind,
  TaskAgentSessionEventSource,
  TaskAgentStage,
  TaskExecutionMode,
  TaskRuntimeExecutionMode,
  TaskWorkspaceMode,
  WorkflowKind,
} from './task-planning-types';

export interface CreatePlanningTaskInput {
  title: string;
  body: string;
  source?: string;
  repoOwner?: string;
  repoName?: string;
  cwd?: string;
  executionMode?: TaskExecutionMode;
  runtimeExecutionMode?: TaskRuntimeExecutionMode;
  workspaceMode?: TaskWorkspaceMode;
  workflowKind?: WorkflowKind;
  attachments?: TaskAttachmentUploadInput[];
}

export interface UpdatePlanningTaskTitleInput {
  taskId: string;
  title: string;
}

export interface SubmitTaskMessageInput {
  taskId: string;
  body: string;
  runtimeExecutionMode?: TaskRuntimeExecutionMode;
  attachments?: TaskAttachmentUploadInput[];
}

export interface PublishTaskPlanInput {
  taskId: string;
  body: string;
  agentId?: string;
  type?: string;
  metadata?: Record<string, unknown>;
}

export interface PublishPlanningUpdateInput {
  taskId: string;
  body: string;
  agentId?: string;
  kind?: string;
}

export interface EnsureTaskAgentBindingInput {
  taskId?: string;
  threadId: string;
  agentId: string;
  runtimeId: string;
  cwd?: string;
  model?: string;
  personalityVersion?: string;
}

export interface CreateTaskAgentRunInput {
  taskId: string;
  threadId: string;
  agentId: string;
  runtimeId: string;
  runtimeSessionIdAtStart?: string;
  inputArtifactIds?: string[];
}

export interface FinishTaskAgentRunInput {
  runId: string;
  status: Exclude<AgentRunStatus, 'running'>;
  runtimeSessionIdAtEnd?: string;
  outputArtifactIds?: string[];
  error?: string;
}

export interface CancelTaskAgentRunInput {
  taskId: string;
  runId?: string;
  reason?: string;
}

export interface CancelTaskAgentRunOutput {
  cancelled: boolean;
  runId?: string;
  run?: TaskAgentRunRecord;
}

export interface RecordTaskAgentProgressInput {
  runId: string;
  taskId: string;
  threadId: string;
  agentId: string;
  runtimeId: string;
  phase: TaskAgentProgressPhase;
  summary: string;
  detail?: string;
}

export interface RecordTaskAgentSessionEventInput {
  runId: string;
  taskId: string;
  threadId: string;
  agentId: string;
  runtimeId: string;
  source: TaskAgentSessionEventSource;
  kind: TaskAgentSessionEventKind;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface RecoverInterruptedTaskAgentRunsOutput {
  recoveredRuns: TaskAgentRunRecord[];
  resetTaskIds: string[];
}

export interface CompleteTaskAgentStageManuallyInput {
  taskId: string;
  stage: TaskAgentStage;
  message?: string;
  prUrl?: string;
  prNumber?: number;
}

export interface RecordTaskAgentResultInput {
  taskId: string;
  threadId: string;
  body: string;
  agentId?: string;
  runtimeId?: string;
  runId?: string;
  metadata?: Record<string, unknown>;
}

export interface RecordTaskExecFailureInput {
  taskId: string;
  error: string;
  agentId?: string;
  runtimeId?: string;
}

export interface UpdateTaskDeliveryInput {
  taskId: string;
  worktreePath?: string;
  branchName?: string;
  commitShas?: string[];
  prUrl?: string;
  prNumber?: number;
}

export interface UpdateTaskRepositoryInput {
  taskId: string;
  repoOwner: string;
  repoName: string;
  cwd?: string;
}
