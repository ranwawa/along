export type TaskStatus =
  | 'planning'
  | 'planning_approved'
  | 'implementing'
  | 'implemented'
  | 'delivering'
  | 'delivered'
  | 'completed';

export type TaskThreadStatus =
  | 'drafting'
  | 'awaiting_approval'
  | 'discussing'
  | 'approved';

export type TaskArtifactType =
  | 'user_message'
  | 'plan_revision'
  | 'planning_update'
  | 'approval'
  | 'agent_result';

export interface TaskItemRecord {
  taskId: string;
  title: string;
  body: string;
  source: string;
  status: TaskStatus;
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
  createdAt: string;
  updatedAt: string;
}

export interface TaskThreadRecord {
  threadId: string;
  taskId: string;
  purpose: 'planning';
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

export type TaskAgentRunStatus = 'running' | 'succeeded' | 'failed';

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

export type TaskAgentStage = 'planning' | 'implementation' | 'delivery';

export type TaskAgentStageStatus = 'idle' | TaskAgentRunStatus;

export interface TaskAgentRunRecord {
  runId: string;
  taskId: string;
  threadId: string;
  agentId: string;
  provider: string;
  providerSessionIdAtStart?: string;
  providerSessionIdAtEnd?: string;
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
  provider: string;
  phase: TaskAgentProgressPhase;
  summary: string;
  detail?: string;
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

export type TaskFlowStageId =
  | 'requirements'
  | 'plan_discussion'
  | 'plan_confirmation'
  | 'implementation'
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
  | 'approve_plan'
  | 'request_revision'
  | 'rerun_planner'
  | 'start_implementation'
  | 'resume_failed_stage'
  | 'copy_resume_command'
  | 'manual_complete'
  | 'start_delivery'
  | 'accept_delivery'
  | 'request_changes';

export type TaskFlowEventType =
  | 'task_created'
  | 'user_feedback'
  | 'plan_revision'
  | 'plan_approved'
  | 'feedback_round'
  | 'agent_run_started'
  | 'agent_run_succeeded'
  | 'agent_run_failed'
  | 'delivery_updated'
  | 'task_completed';

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
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  artifacts: TaskArtifactRecord[];
  plans: TaskPlanRevisionRecord[];
  agentRuns: TaskAgentRunRecord[];
  agentProgressEvents: TaskAgentProgressEventRecord[];
  agentStages: TaskAgentStageRecord[];
  flow: TaskFlowSnapshot;
}
