import type { TaskAttachmentRecord } from './task-attachments';
import type { TaskDisplay } from './task-display-state';
import type {
  AgentRunStatus,
  ArtifactRole,
  ArtifactType,
  FeedbackRoundResolution,
  FeedbackRoundStatus,
  Lifecycle,
  TaskAgentProgressPhase,
  TaskAgentSessionEventKind,
  TaskAgentSessionEventSource,
  TaskAgentStage,
  TaskAgentStageStatus,
  TaskExecutionMode,
  TaskPlanStatus,
  TaskStatus,
  TaskWorkspaceMode,
  ThreadPurpose,
  ThreadStatus,
  WorkflowKind,
} from './task-planning-types';

export interface TaskAgentManualResume {
  available: boolean;
  cwd?: string;
  command?: string;
  sessionId?: string;
  reason?: string;
}

export interface TaskItemRecord {
  taskId: string;
  title: string;
  body: string;
  source: string;
  status: TaskStatus;
  lifecycle: Lifecycle;
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
  purpose: ThreadPurpose;
  status: ThreadStatus;
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
  type: ArtifactType;
  role: ArtifactRole;
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
  status: TaskPlanStatus;
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
  status: FeedbackRoundStatus;
  resolution?: FeedbackRoundResolution;
  producedPlanId?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface TaskAgentBindingRecord {
  threadId: string;
  agentId: string;
  runtimeId: string;
  runtimeSessionId?: string;
  cwd?: string;
  model?: string;
  personalityVersion?: string;
  updatedAt: string;
}

export interface TaskAgentRunRecord {
  runId: string;
  taskId: string;
  threadId: string;
  agentId: string;
  runtimeId: string;
  runtimeSessionIdAtStart?: string;
  runtimeSessionIdAtEnd?: string;
  status: AgentRunStatus;
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

export interface TaskAgentStageRecord {
  stage: TaskAgentStage;
  agentId: string;
  label: string;
  status: TaskAgentStageStatus;
  latestRun?: TaskAgentRunRecord;
  manualResume?: TaskAgentManualResume;
}

export type TaskFlowStageId =
  | 'chat'
  | 'requirements'
  | 'plan_discussion'
  | 'plan_confirmation'
  | 'exec'
  | 'delivery'
  | 'completed';

export type TaskFlowStageState =
  | 'pending'
  | 'current'
  | 'completed'
  | 'blocked'
  | 'attention';

export type TaskFlowActionId =
  | 'submit_feedback'
  | 'request_plan'
  | 'approve_plan'
  | 'request_revision'
  | 'rerun_planner'
  | 'start_exec'
  | 'confirm_exec_steps'
  | 'resume_failed_stage'
  | 'copy_resume_command'
  | 'manual_complete'
  | 'start_delivery'
  | 'accept_delivery'
  | 'request_changes'
  | 'close_task';

export type TaskFlowEventType =
  | 'task_created'
  | 'user_feedback'
  | 'plan_revision'
  | 'plan_approved'
  | 'exec_steps_approved'
  | 'feedback_round'
  | 'agent_run_started'
  | 'agent_run_succeeded'
  | 'agent_run_failed'
  | 'agent_run_cancelled'
  | 'delivery_updated'
  | 'task_completed'
  | 'task_closed';

export interface TaskFlowAction {
  id: TaskFlowActionId;
  label: string;
  description: string;
  enabled: boolean;
  disabledReason?: string;
  stage: TaskFlowStageId;
  variant: 'primary' | 'secondary' | 'danger';
}

export interface TaskFlowStage {
  id: TaskFlowStageId;
  label: string;
  summary: string;
  state: TaskFlowStageState;
  blocker?: string;
  details: string[];
  startedAt?: string;
  endedAt?: string;
}

export interface TaskFlowEvent {
  eventId: string;
  type: TaskFlowEventType;
  stage: TaskFlowStageId;
  title: string;
  summary?: string;
  occurredAt: string;
}

export interface TaskFlowSnapshot {
  currentStageId: TaskFlowStageId;
  conclusion: string;
  severity: 'normal' | 'warning' | 'blocked' | 'success';
  stages: TaskFlowStage[];
  actions: TaskFlowAction[];
  blockers: string[];
  events: TaskFlowEvent[];
}

export interface TaskPlanningSnapshot {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  display: TaskDisplay;
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

export interface ReadTaskPlanningSnapshotOptions {
  includeSessionEvents?: boolean;
}
