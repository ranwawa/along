export {
  LIFECYCLE,
  type Lifecycle,
  WORKFLOW_KIND,
  type WorkflowKind,
} from '../../domain/workflow/state';

export const TASK_STATUS = {
  PLANNING: 'planning',
  PLANNING_APPROVED: 'planning_approved',
  IMPLEMENTING: 'implementing',
  IMPLEMENTED: 'implemented',
  DELIVERING: 'delivering',
  DELIVERED: 'delivered',
  COMPLETED: 'completed',
  CLOSED: 'closed',
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

export const TASK_EXECUTION_MODE = {
  MANUAL: 'manual',
  AUTONOMOUS: 'autonomous',
} as const;

export type TaskExecutionMode =
  (typeof TASK_EXECUTION_MODE)[keyof typeof TASK_EXECUTION_MODE];

export const TASK_RUNTIME_EXECUTION_MODE = {
  AUTO: 'auto',
  CHAT: 'chat',
  PLAN: 'plan',
  EXEC: 'exec',
} as const;

export type TaskRuntimeExecutionMode =
  (typeof TASK_RUNTIME_EXECUTION_MODE)[keyof typeof TASK_RUNTIME_EXECUTION_MODE];

export const TASK_WORKSPACE_MODE = {
  WORKTREE: 'worktree',
  DEFAULT_BRANCH: 'default_branch',
} as const;

export type TaskWorkspaceMode =
  (typeof TASK_WORKSPACE_MODE)[keyof typeof TASK_WORKSPACE_MODE];

export const THREAD_PURPOSE = {
  CHAT: 'chat',
  PLANNING: 'planning',
  EXEC: 'exec',
} as const;

export type ThreadPurpose =
  (typeof THREAD_PURPOSE)[keyof typeof THREAD_PURPOSE];

export const THREAD_STATUS = {
  ACTIVE: 'active',
  WAITING_USER: 'waiting_user',
  ANSWERED: 'answered',
  DRAFTING: 'drafting',
  AWAITING_APPROVAL: 'awaiting_approval',
  DISCUSSING: 'discussing',
  APPROVED: 'approved',
  IMPLEMENTING: 'implementing',
  VERIFYING: 'verifying',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type ThreadStatus = (typeof THREAD_STATUS)[keyof typeof THREAD_STATUS];

export const ARTIFACT_TYPE = {
  USER_MESSAGE: 'user_message',
  CHAT_REPLY: 'chat_reply',
  PLAN_REVISION: 'plan_revision',
  PLANNING_UPDATE: 'planning_update',
  APPROVAL: 'approval',
  AGENT_RESULT: 'agent_result',
  TASK_CLOSED: 'task_closed',
} as const;

export type ArtifactType = (typeof ARTIFACT_TYPE)[keyof typeof ARTIFACT_TYPE];

export const ARTIFACT_ROLE = {
  USER: 'user',
  AGENT: 'agent',
  SYSTEM: 'system',
} as const;

export type ArtifactRole = (typeof ARTIFACT_ROLE)[keyof typeof ARTIFACT_ROLE];

export const PLAN_STATUS = {
  ACTIVE: 'active',
  SUPERSEDED: 'superseded',
  APPROVED: 'approved',
} as const;

export type TaskPlanStatus = (typeof PLAN_STATUS)[keyof typeof PLAN_STATUS];

export const ROUND_STATUS = {
  OPEN: 'open',
  PROCESSING: 'processing',
  STALE_PARTIAL: 'stale_partial',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
} as const;

export type FeedbackRoundStatus =
  (typeof ROUND_STATUS)[keyof typeof ROUND_STATUS];

export const ROUND_RESOLUTION = {
  ANSWER_ONLY: 'answer_only',
  REVISE_PLAN: 'revise_plan',
} as const;

export type FeedbackRoundResolution =
  (typeof ROUND_RESOLUTION)[keyof typeof ROUND_RESOLUTION];

export const AGENT_RUN_STATUS = {
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type AgentRunStatus =
  (typeof AGENT_RUN_STATUS)[keyof typeof AGENT_RUN_STATUS];

export const TASK_AGENT_PROGRESS_PHASE = {
  STARTING: 'starting',
  CONTEXT: 'context',
  TOOL: 'tool',
  WAITING: 'waiting',
  VERIFYING: 'verifying',
  FINALIZING: 'finalizing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type TaskAgentProgressPhase =
  (typeof TASK_AGENT_PROGRESS_PHASE)[keyof typeof TASK_AGENT_PROGRESS_PHASE];

export const TASK_AGENT_STAGE = {
  PLANNING: 'planning',
  EXEC: 'exec',
  DELIVERY: 'delivery',
} as const;

export type TaskAgentStage =
  (typeof TASK_AGENT_STAGE)[keyof typeof TASK_AGENT_STAGE];

export const TASK_AGENT_ID = {
  PLANNING: 'planning',
  EXEC: 'exec',
  DELIVERY: 'delivery',
} as const;

export type TaskAgentId = (typeof TASK_AGENT_ID)[keyof typeof TASK_AGENT_ID];

export type TaskAgentStageStatus = 'idle' | AgentRunStatus;

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
