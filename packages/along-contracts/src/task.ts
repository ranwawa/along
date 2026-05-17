import type { TaskFlowSnapshot } from './task-flow';
import type { TaskDisplay, TaskLifecycle, WorkflowKind } from './workflow';

export type {
  TaskFlowAction,
  TaskFlowActionId,
  TaskFlowEvent,
  TaskFlowEventType,
  TaskFlowSnapshot,
  TaskFlowStage,
  TaskFlowStageId,
  TaskFlowStageState,
} from './task-flow';
export type {
  TaskDisplay,
  TaskDisplayState,
  TaskLifecycle,
  WorkflowKind,
} from './workflow';

export type TaskStatus =
  | 'planning'
  | 'planning_approved'
  | 'implementing'
  | 'implemented'
  | 'delivering'
  | 'delivered'
  | 'completed'
  | 'closed';

export type TaskExecutionMode = 'manual' | 'autonomous';

export type TaskRuntimeExecutionMode = 'auto' | 'chat' | 'plan' | 'exec';

export type TaskWorkspaceMode = 'worktree' | 'default_branch';

export type TaskThreadStatus =
  | 'drafting'
  | 'awaiting_approval'
  | 'revising'
  | 'implementing'
  | 'verifying'
  | 'implemented'
  | 'completed'
  | 'failed';

export type TaskArtifactType =
  | 'user_message'
  | 'chat_reply'
  | 'plan_revision'
  | 'planning_update'
  | 'approval'
  | 'agent_result'
  | 'task_closed';

export interface TaskAttachmentRecord {
  attachmentId: string;
  taskId: string;
  threadId: string;
  artifactId: string;
  kind: 'image';
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  relativePath: string;
  createdAt: string;
  missing?: boolean;
}

export interface TaskItemRecord {
  taskId: string;
  title: string;
  body: string;
  source: string;
  status: TaskStatus;
  lifecycle: TaskLifecycle;
  currentWorkflowKind: WorkflowKind;
  activeThreadId?: string;
  repoOwner?: string;
  repoName?: string;
  cwd?: string;
  worktreePath?: string;
  branchName?: string;
  commitShas: string[];
  prUrl?: string;
  prNumber?: number;
  seq?: number;
  type?: string;
  executionMode: TaskExecutionMode;
  workspaceMode: TaskWorkspaceMode;
  createdAt: string;
  updatedAt: string;
}

export interface TaskThreadRecord {
  threadId: string;
  taskId: string;
  purpose: WorkflowKind;
  status: TaskThreadStatus;
  currentPlanId?: string;
  openRoundId?: string;
  approvedPlanId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskArtifactRecord {
  artifactId: string;
  taskId: string;
  threadId: string;
  type: TaskArtifactType;
  role: 'user' | 'agent' | 'system';
  body: string;
  metadata: Record<string, unknown>;
  attachments: TaskAttachmentRecord[];
  createdAt: string;
}

export interface TaskPlanRevisionRecord {
  planId: string;
  taskId: string;
  threadId: string;
  version: number;
  basedOnPlanId?: string;
  status: 'active' | 'superseded' | 'approved';
  artifactId: string;
  body: string;
  createdAt: string;
}

export interface TaskFeedbackRoundRecord {
  roundId: string;
  taskId: string;
  threadId: string;
  basedOnPlanId: string;
  feedbackArtifactIds: string[];
  status: 'open' | 'processing' | 'stale_partial' | 'resolved' | 'closed';
  resolution?: 'answer_only' | 'revise_plan';
  producedPlanId?: string;
  createdAt: string;
  resolvedAt?: string;
}

export type TaskAgentRunStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type TaskAgentProgressPhase =
  | 'starting'
  | 'context'
  | 'tool'
  | 'waiting'
  | 'verifying'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskAgentStage = 'planning' | 'exec' | 'delivery';

export type TaskAgentStageStatus = 'idle' | TaskAgentRunStatus;

export interface TaskAgentRunRecord {
  runId: string;
  taskId: string;
  threadId: string;
  agentId: string;
  runtimeId: string;
  runtimeSessionIdAtStart?: string;
  runtimeSessionIdAtEnd?: string;
  status: TaskAgentRunStatus;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  error?: string;
  startedAt: string;
  endedAt?: string;
}

export interface TaskAgentProgressEventRecord {
  progressId: string;
  runId: string;
  taskId: string;
  threadId: string;
  agentId: string;
  runtimeId: string;
  phase: TaskAgentProgressPhase;
  summary: string;
  detail?: string;
  createdAt: string;
}

export type TaskAgentSessionEventSource =
  | 'system'
  | 'agent'
  | 'tool'
  | 'stdout'
  | 'stderr';

export type TaskAgentSessionEventKind =
  | 'progress'
  | 'message'
  | 'output'
  | 'error';

export interface TaskAgentSessionEventRecord {
  eventId: string;
  runId: string;
  taskId: string;
  threadId: string;
  agentId: string;
  runtimeId: string;
  source: TaskAgentSessionEventSource;
  kind: TaskAgentSessionEventKind;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TaskAgentManualResume {
  available: boolean;
  cwd?: string;
  command?: string;
  sessionId?: string;
  reason?: string;
}

export interface TaskAgentStageRecord {
  stage: TaskAgentStage;
  agentId: string;
  label: string;
  status: TaskAgentStageStatus;
  latestRun?: TaskAgentRunRecord;
  manualResume?: TaskAgentManualResume;
}

export interface TaskPlanningSnapshot {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  display?: TaskDisplay;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  artifacts: TaskArtifactRecord[];
  plans: TaskPlanRevisionRecord[];
  agentRuns: TaskAgentRunRecord[];
  agentProgressEvents: TaskAgentProgressEventRecord[];
  agentSessionEvents: TaskAgentSessionEventRecord[];
  agentStages: TaskAgentStageRecord[];
  flow: TaskFlowSnapshot;
}
