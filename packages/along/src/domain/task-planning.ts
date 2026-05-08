// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: legacy planning module predates current function-size rule.
// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: legacy planning module predates current file-size rule.
import type { Database } from 'bun:sqlite';
import crypto from 'node:crypto';
import { iso_timestamp } from '../core/common';
import { getDb } from '../core/db';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  cleanupPreparedTaskAttachments,
  mapTaskAttachment,
  type PreparedTaskAttachment,
  prepareTaskImageAttachments,
  type TaskAttachmentRecord,
  type TaskAttachmentRow,
  type TaskAttachmentUploadInput,
} from './task-attachments';
import { deriveTaskDisplay, type TaskDisplay } from './task-display-state';
import {
  areImplementationStepsApproved,
  findImplementationStepsApprovalArtifact,
  findImplementationStepsArtifact,
  IMPLEMENTATION_STEPS_APPROVAL_KIND,
} from './task-implementation-steps';
import {
  reduceWorkflowEvent,
  TASK_LIFECYCLE,
  type TaskLifecycle,
  WORKFLOW_KIND,
  type WorkflowKind,
  type WorkflowRuntimeState,
} from './task-workflow-state';

export type { TaskLifecycle, WorkflowKind };
export { TASK_LIFECYCLE, WORKFLOW_KIND };

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

export const THREAD_PURPOSE = {
  ASK: 'ask',
  PLANNING: 'planning',
  IMPLEMENTATION: 'implementation',
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
  PLANNED: 'planned',
  IMPLEMENTING: 'implementing',
  VERIFYING: 'verifying',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type ThreadStatus = (typeof THREAD_STATUS)[keyof typeof THREAD_STATUS];

export const ARTIFACT_TYPE = {
  USER_MESSAGE: 'user_message',
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
  IMPLEMENTATION: 'implementation',
  DELIVERY: 'delivery',
} as const;

export type TaskAgentStage =
  (typeof TASK_AGENT_STAGE)[keyof typeof TASK_AGENT_STAGE];

export type TaskAgentStageStatus = 'idle' | AgentRunStatus;

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
  provider: string;
  providerSessionId?: string;
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
  provider: string;
  providerSessionIdAtStart?: string;
  providerSessionIdAtEnd?: string;
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
  provider: string;
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
  provider: string;
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
  | 'ask'
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
  | 'request_plan'
  | 'approve_plan'
  | 'request_revision'
  | 'rerun_planner'
  | 'start_implementation'
  | 'confirm_implementation_steps'
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
  | 'implementation_steps_approved'
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

export interface CreatePlanningTaskInput {
  title: string;
  body: string;
  source?: string;
  repoOwner?: string;
  repoName?: string;
  cwd?: string;
  executionMode?: TaskExecutionMode;
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
  attachments?: TaskAttachmentUploadInput[];
}

export interface PublishTaskPlanInput {
  taskId: string;
  body: string;
  agentId?: string;
  type?: string;
}

export interface PublishPlanningUpdateInput {
  taskId: string;
  body: string;
  agentId?: string;
  kind?: string;
}

export interface EnsureTaskAgentBindingInput {
  threadId: string;
  agentId: string;
  provider: string;
  cwd?: string;
  model?: string;
  personalityVersion?: string;
}

export interface CreateTaskAgentRunInput {
  taskId: string;
  threadId: string;
  agentId: string;
  provider: string;
  providerSessionIdAtStart?: string;
  inputArtifactIds?: string[];
}

export interface FinishTaskAgentRunInput {
  runId: string;
  status: Exclude<AgentRunStatus, 'running'>;
  providerSessionIdAtEnd?: string;
  outputArtifactIds?: string[];
  error?: string;
}

export interface RecordTaskAgentProgressInput {
  runId: string;
  taskId: string;
  threadId: string;
  agentId: string;
  provider: string;
  phase: TaskAgentProgressPhase;
  summary: string;
  detail?: string;
}

export interface RecordTaskAgentSessionEventInput {
  runId: string;
  taskId: string;
  threadId: string;
  agentId: string;
  provider: string;
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
  provider?: string;
  runId?: string;
  metadata?: Record<string, unknown>;
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

interface TaskThreadRow {
  thread_id: string;
  task_id: string;
  purpose: ThreadPurpose;
  status: ThreadStatus;
  current_plan_id: string | null;
  open_round_id: string | null;
  approved_plan_id: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskArtifactRow {
  artifact_id: string;
  task_id: string;
  thread_id: string;
  type: ArtifactType;
  role: ArtifactRole;
  body: string;
  metadata: string;
  created_at: string;
}

interface TaskItemRow {
  task_id: string;
  title: string;
  body: string;
  source: string;
  lifecycle?: TaskLifecycle | null;
  current_workflow_kind?: WorkflowKind | null;
  active_thread_id: string | null;
  repo_owner: string | null;
  repo_name: string | null;
  cwd: string | null;
  worktree_path: string | null;
  branch_name: string | null;
  commit_shas: string | null;
  pr_url: string | null;
  pr_number: number | null;
  seq: number | null;
  type: string | null;
  execution_mode?: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskPlanRevisionRow {
  plan_id: string;
  task_id: string;
  thread_id: string;
  version: number;
  based_on_plan_id: string | null;
  status: TaskPlanStatus;
  artifact_id: string;
  body: string;
  created_at: string;
}

interface TaskFeedbackRoundRow {
  round_id: string;
  task_id: string;
  thread_id: string;
  based_on_plan_id: string;
  feedback_artifact_ids: string;
  status: FeedbackRoundStatus;
  resolution: FeedbackRoundResolution | null;
  produced_plan_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface TaskAgentBindingRow {
  thread_id: string;
  agent_id: string;
  provider: string;
  provider_session_id: string | null;
  cwd: string | null;
  model: string | null;
  personality_version: string | null;
  updated_at: string;
}

interface TaskAgentRunRow {
  run_id: string;
  task_id: string;
  thread_id: string;
  agent_id: string;
  provider: string;
  provider_session_id_at_start: string | null;
  provider_session_id_at_end: string | null;
  status: AgentRunStatus;
  input_artifact_ids: string;
  output_artifact_ids: string;
  error: string | null;
  started_at: string;
  ended_at: string | null;
}

interface TaskAgentProgressEventRow {
  progress_id: string;
  run_id: string;
  task_id: string;
  thread_id: string;
  agent_id: string;
  provider: string;
  phase: TaskAgentProgressPhase;
  summary: string;
  detail: string | null;
  created_at: string;
}

interface TaskAgentSessionEventRow {
  event_id: string;
  run_id: string;
  task_id: string;
  thread_id: string;
  agent_id: string;
  provider: string;
  source: TaskAgentSessionEventSource;
  kind: TaskAgentSessionEventKind;
  content: string;
  metadata: string;
  created_at: string;
}

interface TaskIdRow {
  task_id: string;
}

interface TableInfoRow {
  name: string;
}

interface LatestProviderSessionRow {
  provider_session_id_at_end: string;
}

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function normalizeTaskExecutionMode(
  value: string | null | undefined,
): TaskExecutionMode {
  return value === TASK_EXECUTION_MODE.AUTONOMOUS
    ? TASK_EXECUTION_MODE.AUTONOMOUS
    : TASK_EXECUTION_MODE.MANUAL;
}

function normalizeWorkflowKind(value: string | null | undefined): WorkflowKind {
  if (value === WORKFLOW_KIND.PLANNING) return WORKFLOW_KIND.PLANNING;
  if (value === WORKFLOW_KIND.IMPLEMENTATION)
    return WORKFLOW_KIND.IMPLEMENTATION;
  return WORKFLOW_KIND.ASK;
}

function normalizeTaskLifecycle(
  value: string | null | undefined,
): TaskLifecycle {
  if (
    value === TASK_LIFECYCLE.OPEN ||
    value === TASK_LIFECYCLE.WAITING_USER ||
    value === TASK_LIFECYCLE.READY ||
    value === TASK_LIFECYCLE.RUNNING ||
    value === TASK_LIFECYCLE.COMPLETED ||
    value === TASK_LIFECYCLE.CANCELLED ||
    value === TASK_LIFECYCLE.FAILED
  ) {
    return value;
  }
  return TASK_LIFECYCLE.OPEN;
}

function parseMetadata(
  value: string | null | undefined,
): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const SESSION_EVENT_CONTENT_LIMIT = 8000;
const SECRET_VALUE = '[REDACTED]';

function redactSensitiveContent(value: string): string {
  return value
    .replace(
      /\b(?:ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[baprs])_[A-Za-z0-9_=-]{16,}\b/g,
      SECRET_VALUE,
    )
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, SECRET_VALUE)
    .replace(
      /\b((?:api[_-]?key|token|secret|password|authorization|bearer)\s*[:=]\s*["']?)([^\s"',;]+)/gi,
      `$1${SECRET_VALUE}`,
    )
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)[A-Z0-9_]*\s*=\s*)([^\s]+)/g,
      `$1${SECRET_VALUE}`,
    );
}

function normalizeSessionEventContent(value: string): string {
  const redacted = redactSensitiveContent(value.trim());
  if (redacted.length <= SESSION_EVENT_CONTENT_LIMIT) return redacted;
  const omitted = redacted.length - SESSION_EVENT_CONTENT_LIMIT;
  return `${redacted.slice(
    0,
    SESSION_EVENT_CONTENT_LIMIT,
  )}\n...[已截断 ${omitted} 字符]`;
}

function mapThread(row: TaskThreadRow): TaskThreadRecord {
  return {
    threadId: row.thread_id,
    taskId: row.task_id,
    purpose: row.purpose,
    status: row.status,
    currentPlanId: row.current_plan_id || undefined,
    openRoundId: row.open_round_id || undefined,
    approvedPlanId: row.approved_plan_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapArtifact(row: TaskArtifactRow): TaskArtifactRecord {
  return {
    artifactId: row.artifact_id,
    taskId: row.task_id,
    threadId: row.thread_id,
    type: row.type,
    role: row.role,
    body: row.body,
    metadata: parseMetadata(row.metadata),
    attachments: [],
    createdAt: row.created_at,
  };
}

function mapPlan(row: TaskPlanRevisionRow): TaskPlanRevisionRecord {
  return {
    planId: row.plan_id,
    taskId: row.task_id,
    threadId: row.thread_id,
    version: row.version,
    basedOnPlanId: row.based_on_plan_id || undefined,
    status: row.status,
    artifactId: row.artifact_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

function mapTask(row: TaskItemRow): TaskItemRecord {
  const lifecycle = normalizeTaskLifecycle(row.lifecycle);
  const currentWorkflowKind = normalizeWorkflowKind(row.current_workflow_kind);
  return {
    taskId: row.task_id,
    title: row.title,
    body: row.body,
    source: row.source,
    status: deriveTaskStatusFromWorkflow(
      {
        lifecycle,
        currentWorkflowKind,
        workflowState:
          currentWorkflowKind === WORKFLOW_KIND.ASK ? 'active' : 'drafting',
      },
      { prUrl: row.pr_url || undefined },
    ),
    lifecycle,
    currentWorkflowKind,
    activeThreadId: row.active_thread_id || undefined,
    repoOwner: row.repo_owner || undefined,
    repoName: row.repo_name || undefined,
    cwd: row.cwd || undefined,
    worktreePath: row.worktree_path || undefined,
    branchName: row.branch_name || undefined,
    commitShas: parseStringArray(row.commit_shas),
    prUrl: row.pr_url || undefined,
    prNumber: row.pr_number || undefined,
    seq: row.seq || undefined,
    type: row.type || undefined,
    executionMode: normalizeTaskExecutionMode(row.execution_mode),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hasLegacyTaskStatusColumn(db: Pick<Database, 'prepare'>): boolean {
  try {
    const rows = db
      .prepare('PRAGMA table_info(task_items)')
      .all() as TableInfoRow[];
    return rows.some((row) => row.name === 'status');
  } catch {
    return false;
  }
}

function mapRound(row: TaskFeedbackRoundRow): TaskFeedbackRoundRecord {
  return {
    roundId: row.round_id,
    taskId: row.task_id,
    threadId: row.thread_id,
    basedOnPlanId: row.based_on_plan_id,
    feedbackArtifactIds: parseStringArray(row.feedback_artifact_ids),
    status: row.status,
    resolution: row.resolution || undefined,
    producedPlanId: row.produced_plan_id || undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || undefined,
  };
}

function mapBinding(row: TaskAgentBindingRow): TaskAgentBindingRecord {
  return {
    threadId: row.thread_id,
    agentId: row.agent_id,
    provider: row.provider,
    providerSessionId: row.provider_session_id || undefined,
    cwd: row.cwd || undefined,
    model: row.model || undefined,
    personalityVersion: row.personality_version || undefined,
    updatedAt: row.updated_at,
  };
}

function mapRun(row: TaskAgentRunRow): TaskAgentRunRecord {
  return {
    runId: row.run_id,
    taskId: row.task_id,
    threadId: row.thread_id,
    agentId: row.agent_id,
    provider: row.provider,
    providerSessionIdAtStart: row.provider_session_id_at_start || undefined,
    providerSessionIdAtEnd: row.provider_session_id_at_end || undefined,
    status: row.status,
    inputArtifactIds: parseStringArray(row.input_artifact_ids),
    outputArtifactIds: parseStringArray(row.output_artifact_ids),
    error: row.error || undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at || undefined,
  };
}

function mapProgressEvent(
  row: TaskAgentProgressEventRow,
): TaskAgentProgressEventRecord {
  return {
    progressId: row.progress_id,
    runId: row.run_id,
    taskId: row.task_id,
    threadId: row.thread_id,
    agentId: row.agent_id,
    provider: row.provider,
    phase: row.phase,
    summary: row.summary,
    detail: row.detail || undefined,
    createdAt: row.created_at,
  };
}

function mapSessionEvent(
  row: TaskAgentSessionEventRow,
): TaskAgentSessionEventRecord {
  return {
    eventId: row.event_id,
    runId: row.run_id,
    taskId: row.task_id,
    threadId: row.thread_id,
    agentId: row.agent_id,
    provider: row.provider,
    source: row.source,
    kind: row.kind,
    content: row.content,
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at,
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const TASK_AGENT_STAGE_DEFINITIONS: Array<{
  stage: TaskAgentStage;
  agentId: string;
  label: string;
}> = [
  {
    stage: TASK_AGENT_STAGE.PLANNING,
    agentId: 'planner',
    label: '计划阶段',
  },
  {
    stage: TASK_AGENT_STAGE.IMPLEMENTATION,
    agentId: 'implementer',
    label: '实现阶段',
  },
  {
    stage: TASK_AGENT_STAGE.DELIVERY,
    agentId: 'delivery',
    label: '交付阶段',
  },
];

function buildTaskAgentStages(
  runs: TaskAgentRunRecord[],
  bindings: TaskAgentBindingRecord[],
  task: TaskItemRecord,
): TaskAgentStageRecord[] {
  return TASK_AGENT_STAGE_DEFINITIONS.map((definition) => {
    const latestRun = runs
      .filter((run) => run.agentId === definition.agentId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
    const binding = bindings.find(
      (item) =>
        item.agentId === definition.agentId &&
        (!latestRun || item.provider === latestRun.provider),
    );
    const fallbackBinding = bindings.find(
      (item) => item.agentId === definition.agentId,
    );
    const provider = latestRun?.provider || binding?.provider;
    const sessionId =
      latestRun?.providerSessionIdAtEnd ||
      binding?.providerSessionId ||
      latestRun?.providerSessionIdAtStart;
    const cwd =
      binding?.cwd ||
      fallbackBinding?.cwd ||
      (definition.stage === TASK_AGENT_STAGE.IMPLEMENTATION
        ? task.worktreePath || task.cwd
        : task.cwd || task.worktreePath);

    return {
      ...definition,
      status: latestRun?.status || 'idle',
      latestRun,
      manualResume: buildManualResume(provider, cwd, sessionId),
    };
  });
}

const TASK_FLOW_STAGE_ORDER: TaskFlowStageId[] = [
  'ask',
  'requirements',
  'plan_discussion',
  'plan_confirmation',
  'implementation',
  'delivery',
  'completed',
];

const TASK_FLOW_STAGE_LABELS: Record<TaskFlowStageId, string> = {
  ask: '咨询问答',
  requirements: '需求接收',
  plan_discussion: '计划讨论',
  plan_confirmation: '计划确认',
  implementation: '实现执行',
  delivery: '结果交付',
  completed: '已完成',
};

function isTaskCancelled(task: TaskItemRecord): boolean {
  return task.lifecycle === TASK_LIFECYCLE.CANCELLED;
}

function isTaskCompleted(task: TaskItemRecord): boolean {
  return task.lifecycle === TASK_LIFECYCLE.COMPLETED;
}

function isTaskDelivered(task: TaskItemRecord): boolean {
  return (
    task.lifecycle === TASK_LIFECYCLE.READY &&
    task.currentWorkflowKind === WORKFLOW_KIND.IMPLEMENTATION &&
    Boolean(task.prUrl)
  );
}

function isTaskImplemented(task: TaskItemRecord): boolean {
  return (
    task.lifecycle === TASK_LIFECYCLE.READY &&
    task.currentWorkflowKind === WORKFLOW_KIND.IMPLEMENTATION &&
    !task.prUrl
  );
}

function isTaskDelivering(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
}): boolean {
  return (
    input.task.lifecycle === TASK_LIFECYCLE.RUNNING &&
    input.task.currentWorkflowKind === WORKFLOW_KIND.IMPLEMENTATION &&
    input.thread.status === THREAD_STATUS.VERIFYING
  );
}

function isTaskImplementing(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
}): boolean {
  return (
    input.task.lifecycle === TASK_LIFECYCLE.RUNNING &&
    input.task.currentWorkflowKind === WORKFLOW_KIND.IMPLEMENTATION &&
    input.thread.status !== THREAD_STATUS.VERIFYING
  );
}

function isPlanningApproved(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
}): boolean {
  return (
    input.task.lifecycle === TASK_LIFECYCLE.READY &&
    input.task.currentWorkflowKind === WORKFLOW_KIND.PLANNING &&
    Boolean(input.thread.approvedPlanId)
  );
}

function isPlanningActive(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
}): boolean {
  return (
    input.task.currentWorkflowKind === WORKFLOW_KIND.PLANNING &&
    !isPlanningApproved(input)
  );
}

function deriveTaskStatusFromWorkflow(
  workflow: WorkflowRuntimeState,
  task?: Pick<TaskItemRecord, 'prUrl'>,
): TaskStatus {
  if (workflow.lifecycle === TASK_LIFECYCLE.CANCELLED) {
    return TASK_STATUS.CLOSED;
  }
  if (workflow.lifecycle === TASK_LIFECYCLE.COMPLETED) {
    return TASK_STATUS.COMPLETED;
  }
  if (workflow.currentWorkflowKind === WORKFLOW_KIND.IMPLEMENTATION) {
    if (workflow.workflowState === 'verifying') {
      return TASK_STATUS.DELIVERING;
    }
    if (workflow.workflowState === 'completed') {
      return task?.prUrl ? TASK_STATUS.DELIVERED : TASK_STATUS.IMPLEMENTED;
    }
    return TASK_STATUS.IMPLEMENTING;
  }
  if (
    workflow.currentWorkflowKind === WORKFLOW_KIND.PLANNING &&
    workflow.workflowState === 'planned'
  ) {
    return TASK_STATUS.PLANNING_APPROVED;
  }
  return TASK_STATUS.PLANNING;
}

function inferWorkflowState(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  agentStages: TaskAgentStageRecord[];
}): WorkflowRuntimeState {
  if (isTaskCancelled(input.task)) {
    return {
      lifecycle: TASK_LIFECYCLE.CANCELLED,
      currentWorkflowKind: input.task.currentWorkflowKind,
      workflowState:
        input.task.currentWorkflowKind === WORKFLOW_KIND.IMPLEMENTATION
          ? 'failed'
          : input.task.currentWorkflowKind === WORKFLOW_KIND.PLANNING
            ? 'planned'
            : 'answered',
    };
  }
  if (isTaskCompleted(input.task)) {
    return {
      lifecycle: TASK_LIFECYCLE.COMPLETED,
      currentWorkflowKind: WORKFLOW_KIND.IMPLEMENTATION,
      workflowState: 'completed',
    };
  }
  if (input.task.currentWorkflowKind === WORKFLOW_KIND.IMPLEMENTATION) {
    const runningStage = input.agentStages.find(
      (stage) =>
        stage.stage === TASK_AGENT_STAGE.IMPLEMENTATION &&
        stage.status === AGENT_RUN_STATUS.RUNNING,
    );
    const failedStage = input.agentStages.find(
      (stage) =>
        stage.stage === TASK_AGENT_STAGE.IMPLEMENTATION &&
        stage.status === AGENT_RUN_STATUS.FAILED,
    );
    if (failedStage) {
      return {
        lifecycle: TASK_LIFECYCLE.FAILED,
        currentWorkflowKind: WORKFLOW_KIND.IMPLEMENTATION,
        workflowState: 'failed',
      };
    }
    if (
      input.thread.status === THREAD_STATUS.VERIFYING ||
      input.agentStages.some(
        (stage) =>
          stage.stage === TASK_AGENT_STAGE.DELIVERY &&
          stage.status === AGENT_RUN_STATUS.RUNNING,
      )
    ) {
      return {
        lifecycle: TASK_LIFECYCLE.RUNNING,
        currentWorkflowKind: WORKFLOW_KIND.IMPLEMENTATION,
        workflowState: 'verifying',
      };
    }
    if (runningStage || input.task.lifecycle === TASK_LIFECYCLE.RUNNING) {
      return reduceWorkflowEvent(
        {
          lifecycle: TASK_LIFECYCLE.READY,
          currentWorkflowKind: WORKFLOW_KIND.PLANNING,
          workflowState: 'planned',
        },
        { type: 'implementation.started' },
      );
    }
    return {
      lifecycle: input.task.lifecycle,
      currentWorkflowKind: WORKFLOW_KIND.IMPLEMENTATION,
      workflowState:
        input.thread.status === THREAD_STATUS.FAILED ? 'failed' : 'completed',
    };
  }
  if (
    input.task.currentWorkflowKind === WORKFLOW_KIND.ASK &&
    input.thread.purpose === THREAD_PURPOSE.ASK &&
    !input.currentPlan
  ) {
    return {
      lifecycle: input.task.lifecycle,
      currentWorkflowKind: WORKFLOW_KIND.ASK,
      workflowState:
        input.thread.status === THREAD_STATUS.WAITING_USER
          ? 'waiting_user'
          : input.thread.status === THREAD_STATUS.ANSWERED
            ? 'answered'
            : 'active',
    };
  }
  if (input.openRound) {
    return {
      lifecycle: TASK_LIFECYCLE.OPEN,
      currentWorkflowKind: WORKFLOW_KIND.PLANNING,
      workflowState: 'feedback',
    };
  }
  if (
    input.thread.approvedPlanId ||
    input.thread.status === THREAD_STATUS.APPROVED ||
    input.thread.status === THREAD_STATUS.PLANNED
  ) {
    return {
      lifecycle: TASK_LIFECYCLE.READY,
      currentWorkflowKind: WORKFLOW_KIND.PLANNING,
      workflowState: 'planned',
    };
  }
  if (
    input.currentPlan ||
    input.thread.status === THREAD_STATUS.AWAITING_APPROVAL
  ) {
    return {
      lifecycle: TASK_LIFECYCLE.WAITING_USER,
      currentWorkflowKind: WORKFLOW_KIND.PLANNING,
      workflowState: 'awaiting_approval',
    };
  }
  return {
    lifecycle: input.task.lifecycle,
    currentWorkflowKind:
      input.thread.purpose === THREAD_PURPOSE.PLANNING
        ? WORKFLOW_KIND.PLANNING
        : WORKFLOW_KIND.ASK,
    workflowState:
      input.thread.status === THREAD_STATUS.WAITING_USER
        ? 'waiting_user'
        : input.thread.purpose === THREAD_PURPOSE.PLANNING
          ? 'drafting'
          : 'active',
  };
}

function applyWorkflowView(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  agentStages: TaskAgentStageRecord[];
}): {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  display: TaskDisplay;
  workflow: WorkflowRuntimeState;
} {
  const workflow = inferWorkflowState(input);
  return {
    task: {
      ...input.task,
      status: deriveTaskStatusFromWorkflow(workflow, input.task),
      lifecycle: workflow.lifecycle,
      currentWorkflowKind: workflow.currentWorkflowKind,
    },
    thread: {
      ...input.thread,
      purpose: workflow.currentWorkflowKind,
      status: workflow.workflowState as ThreadStatus,
    },
    display: deriveTaskDisplay(workflow),
    workflow,
  };
}

function isLongRunning(run: TaskAgentRunRecord): boolean {
  const startedAt = new Date(run.startedAt).getTime();
  if (Number.isNaN(startedAt)) return false;
  return Date.now() - startedAt > 30 * 60 * 1000;
}

function getStageByAgentStage(
  stages: TaskAgentStageRecord[],
  stage: TaskAgentStage,
): TaskAgentStageRecord | undefined {
  return stages.find((item) => item.stage === stage);
}

function getLatestFailedAgentStage(
  stages: TaskAgentStageRecord[],
): TaskAgentStageRecord | undefined {
  return stages
    .filter((stage) => stage.status === AGENT_RUN_STATUS.FAILED)
    .sort((left, right) =>
      (
        right.latestRun?.endedAt ||
        right.latestRun?.startedAt ||
        ''
      ).localeCompare(
        left.latestRun?.endedAt || left.latestRun?.startedAt || '',
      ),
    )[0];
}

function getCurrentTaskFlowStageId(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  agentStages: TaskAgentStageRecord[];
}): TaskFlowStageId {
  if (isTaskCancelled(input.task)) return 'completed';
  if (isTaskCompleted(input.task)) return 'completed';
  if (input.task.currentWorkflowKind === WORKFLOW_KIND.ASK) return 'ask';
  if (isTaskDelivered(input.task)) return 'delivery';
  if (input.openRound) return 'plan_discussion';

  const failedStage = getLatestFailedAgentStage(input.agentStages);
  if (failedStage?.stage === TASK_AGENT_STAGE.PLANNING) {
    return 'plan_discussion';
  }
  if (failedStage?.stage === TASK_AGENT_STAGE.IMPLEMENTATION) {
    return 'implementation';
  }
  if (failedStage?.stage === TASK_AGENT_STAGE.DELIVERY) {
    return 'delivery';
  }

  const planningStage = getStageByAgentStage(
    input.agentStages,
    TASK_AGENT_STAGE.PLANNING,
  );
  if (
    !input.currentPlan &&
    (input.thread.status === THREAD_STATUS.DRAFTING ||
      planningStage?.status === AGENT_RUN_STATUS.RUNNING)
  ) {
    return planningStage?.status === AGENT_RUN_STATUS.RUNNING
      ? 'plan_discussion'
      : 'requirements';
  }
  if (input.thread.status === THREAD_STATUS.AWAITING_APPROVAL) {
    return 'plan_confirmation';
  }
  if (isTaskImplementing(input)) return 'implementation';

  const implementationStage = getStageByAgentStage(
    input.agentStages,
    TASK_AGENT_STAGE.IMPLEMENTATION,
  );
  if (implementationStage?.status === AGENT_RUN_STATUS.RUNNING) {
    return 'implementation';
  }
  if (isTaskImplemented(input.task)) return 'delivery';
  if (isTaskDelivering(input)) return 'delivery';

  const deliveryStage = getStageByAgentStage(
    input.agentStages,
    TASK_AGENT_STAGE.DELIVERY,
  );
  if (deliveryStage?.status === AGENT_RUN_STATUS.RUNNING) return 'delivery';
  if (isPlanningApproved(input)) {
    return 'implementation';
  }
  return input.currentPlan ? 'plan_confirmation' : 'plan_discussion';
}

function getAgentRunFailureSummary(run: TaskAgentRunRecord): string {
  if (!run.error) return 'Agent 运行失败，需要人工查看运行记录后接管。';
  const firstLine = run.error
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return 'Agent 运行失败，需要人工查看运行记录后接管。';
  return firstLine.length > 120 ? `${firstLine.slice(0, 120)}...` : firstLine;
}

function buildTaskFlowConclusion(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  artifacts: TaskArtifactRecord[];
  failedStage?: TaskAgentStageRecord;
  runningStage?: TaskAgentStageRecord;
}): Pick<TaskFlowSnapshot, 'conclusion' | 'severity'> {
  if (isTaskCancelled(input.task)) {
    return {
      conclusion: '任务已关闭，不再继续推进。',
      severity: 'blocked',
    };
  }
  if (isTaskCompleted(input.task)) {
    return { conclusion: '任务已完成，关键产物已归档。', severity: 'success' };
  }
  if (input.task.currentWorkflowKind === WORKFLOW_KIND.ASK) {
    if (input.thread.status === THREAD_STATUS.ANSWERED) {
      return {
        conclusion: '咨询已回答，可以继续追问或转为计划。',
        severity: 'success',
      };
    }
    if (input.thread.status === THREAD_STATUS.WAITING_USER) {
      return { conclusion: '当前咨询需要补充信息。', severity: 'warning' };
    }
    return { conclusion: '咨询正在处理中。', severity: 'normal' };
  }
  if (isTaskDelivered(input.task)) {
    return {
      conclusion: '结果已交付，等待验收或继续修改。',
      severity: 'success',
    };
  }
  if (input.failedStage?.latestRun) {
    return {
      conclusion: `${input.failedStage.label}失败，需要人工接管。`,
      severity: 'blocked',
    };
  }
  if (input.openRound) {
    return {
      conclusion: '当前反馈轮次已打开，等待 Planner 处理你的补充反馈。',
      severity: 'warning',
    };
  }
  if (input.runningStage?.latestRun) {
    const attention = isLongRunning(input.runningStage.latestRun);
    return {
      conclusion: attention
        ? `${input.runningStage.label}运行时间较长，需要关注或人工接管。`
        : `${input.runningStage.label}正在执行。`,
      severity: attention ? 'warning' : 'normal',
    };
  }
  if (
    input.thread.status === THREAD_STATUS.AWAITING_APPROVAL &&
    input.currentPlan
  ) {
    return { conclusion: '等待你确认计划。', severity: 'normal' };
  }
  if (isPlanningApproved(input)) {
    const approvedPlan =
      input.currentPlan?.planId === input.thread.approvedPlanId
        ? input.currentPlan
        : null;
    const steps = approvedPlan
      ? findImplementationStepsArtifact(input, approvedPlan)
      : undefined;
    const stepsApproved = approvedPlan
      ? areImplementationStepsApproved(input, approvedPlan)
      : false;
    if (steps && !stepsApproved) {
      return {
        conclusion: '实施步骤已产出，等待你确认后开始编码。',
        severity: 'normal',
      };
    }
    return {
      conclusion: stepsApproved
        ? '实施步骤已确认，可以开始编码。'
        : '计划已确认，可以先产出实施步骤。',
      severity: 'normal',
    };
  }
  if (isTaskImplemented(input.task)) {
    return {
      conclusion: '实现已完成，可以提交并创建 PR。',
      severity: 'normal',
    };
  }
  if (isTaskDelivering(input)) {
    return { conclusion: '交付流程正在处理。', severity: 'normal' };
  }
  if (!input.currentPlan) {
    return {
      conclusion: '需求已接收，等待 Planner 输出计划。',
      severity: 'normal',
    };
  }
  return { conclusion: '任务正在计划流程中。', severity: 'normal' };
}

function buildTaskFlowAction(
  input: Omit<TaskFlowAction, 'enabled'> & {
    enabled: boolean;
    disabledReason?: string;
  },
): TaskFlowAction {
  return {
    id: input.id,
    label: input.label,
    description: input.description,
    enabled: input.enabled,
    disabledReason: input.enabled ? undefined : input.disabledReason,
    stage: input.stage,
    variant: input.variant,
  };
}

function buildTaskFlowActions(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  artifacts: TaskArtifactRecord[];
  agentStages: TaskAgentStageRecord[];
}): TaskFlowAction[] {
  if (isTaskCancelled(input.task)) return [];
  if (input.task.currentWorkflowKind === WORKFLOW_KIND.ASK) {
    return [
      buildTaskFlowAction({
        id: 'submit_feedback',
        label: '继续提问',
        description: '补充问题或继续当前咨询',
        enabled: true,
        stage: 'ask',
        variant: 'secondary',
      }),
      buildTaskFlowAction({
        id: 'request_plan',
        label: '转为计划',
        description: '把当前咨询切换为正式计划流程',
        enabled: true,
        stage: 'ask',
        variant: 'primary',
      }),
      buildTaskFlowAction({
        id: 'close_task',
        label: '关闭任务',
        description: '结束当前咨询并保留历史记录',
        enabled: true,
        stage: 'ask',
        variant: 'danger',
      }),
    ];
  }

  const failedStage = getLatestFailedAgentStage(input.agentStages);
  const implementationStage = getStageByAgentStage(
    input.agentStages,
    TASK_AGENT_STAGE.IMPLEMENTATION,
  );
  const deliveryStage = getStageByAgentStage(
    input.agentStages,
    TASK_AGENT_STAGE.DELIVERY,
  );
  const canSubmitFeedback =
    input.thread.status !== THREAD_STATUS.APPROVED ||
    isTaskDelivered(input.task) ||
    isTaskCompleted(input.task);
  const canApprove = Boolean(
    input.currentPlan &&
      !input.openRound &&
      input.thread.status !== THREAD_STATUS.APPROVED,
  );
  const canImplement = Boolean(
    input.thread.approvedPlanId &&
      isPlanningApproved(input) &&
      implementationStage?.status !== AGENT_RUN_STATUS.RUNNING,
  );
  const approvedPlan =
    input.currentPlan?.planId === input.thread.approvedPlanId
      ? input.currentPlan
      : null;
  const implementationSteps = approvedPlan
    ? findImplementationStepsArtifact(input, approvedPlan)
    : undefined;
  const implementationStepsApproved = approvedPlan
    ? areImplementationStepsApproved(input, approvedPlan)
    : false;
  const needsImplementationStepsConfirmation = Boolean(
    implementationSteps && !implementationStepsApproved,
  );
  const canDeliver = Boolean(
    isTaskImplemented(input.task) &&
      deliveryStage?.status !== AGENT_RUN_STATUS.RUNNING,
  );
  const canAcceptDelivery = isTaskDelivered(input.task);
  const failedResumeReason = failedStage?.manualResume?.command
    ? undefined
    : failedStage?.manualResume?.reason || '当前没有失败阶段可接管';
  const failedFlowStage: TaskFlowStageId =
    failedStage?.stage === TASK_AGENT_STAGE.PLANNING
      ? 'plan_discussion'
      : failedStage?.stage === TASK_AGENT_STAGE.DELIVERY
        ? 'delivery'
        : 'implementation';

  return [
    buildTaskFlowAction({
      id: 'submit_feedback',
      label: input.openRound ? '补充当前反馈' : '继续讨论',
      description: input.openRound
        ? `反馈会进入当前轮次 ${input.openRound.roundId}`
        : '补充需求、提问或说明验收后的修改要求',
      enabled: canSubmitFeedback,
      disabledReason: '当前已进入实现链路，不能再直接修改计划讨论',
      stage: 'plan_discussion',
      variant: 'secondary',
    }),
    buildTaskFlowAction({
      id: 'approve_plan',
      label: '批准计划',
      description: '确认当前计划并进入实现准备',
      enabled: canApprove,
      disabledReason: input.openRound
        ? '当前仍有开放反馈轮次'
        : input.currentPlan
          ? '计划已经批准'
          : '当前还没有可批准的计划',
      stage: 'plan_confirmation',
      variant: 'primary',
    }),
    buildTaskFlowAction({
      id: 'request_revision',
      label: '要求修订',
      description: '提交反馈并要求 Planner 产出新版计划',
      enabled: Boolean(
        input.currentPlan && input.thread.status !== THREAD_STATUS.APPROVED,
      ),
      disabledReason: input.currentPlan
        ? '计划已批准，不能在此阶段要求修订'
        : '当前还没有可修订的计划',
      stage: 'plan_confirmation',
      variant: 'secondary',
    }),
    buildTaskFlowAction({
      id: 'rerun_planner',
      label: '重新规划',
      description: '重新调度 Planner 处理当前上下文',
      enabled: isPlanningActive(input),
      disabledReason: '当前不处于计划阶段',
      stage: 'plan_discussion',
      variant:
        failedStage?.stage === TASK_AGENT_STAGE.PLANNING
          ? 'danger'
          : 'secondary',
    }),
    buildTaskFlowAction({
      id: needsImplementationStepsConfirmation
        ? 'confirm_implementation_steps'
        : 'start_implementation',
      label: needsImplementationStepsConfirmation
        ? '确认步骤并开始实现'
        : implementationStepsApproved
          ? '开始实现'
          : '产出实施步骤',
      description: needsImplementationStepsConfirmation
        ? '确认 Implementation Agent 输出的实施步骤并开始编码'
        : implementationStepsApproved
          ? '按已确认实施步骤启动 Implementation Agent'
          : '先让 Implementation Agent 产出详细实施步骤',
      enabled: canImplement,
      disabledReason: input.thread.approvedPlanId
        ? isTaskImplementing(input)
          ? '实现 Agent 正在执行'
          : '当前 Task 状态不能开始实现'
        : '当前没有已批准计划',
      stage: 'implementation',
      variant: 'primary',
    }),
    buildTaskFlowAction({
      id: 'resume_failed_stage',
      label: '继续执行',
      description: failedStage
        ? `恢复 ${failedStage.label} 的失败会话并继续执行`
        : '恢复最近失败阶段并继续执行',
      enabled: Boolean(failedStage),
      disabledReason: '当前没有失败阶段可继续执行',
      stage: failedFlowStage,
      variant: 'primary',
    }),
    buildTaskFlowAction({
      id: 'copy_resume_command',
      label: '复制接管命令',
      description: '复制失败阶段的本地接管命令',
      enabled: Boolean(failedStage?.manualResume?.command),
      disabledReason: failedResumeReason,
      stage: failedFlowStage,
      variant: 'secondary',
    }),
    buildTaskFlowAction({
      id: 'manual_complete',
      label: '人工已处理',
      description: '将失败阶段标记为已由人工处理',
      enabled: Boolean(failedStage),
      disabledReason: '当前没有失败阶段需要人工标记',
      stage: failedFlowStage,
      variant: 'primary',
    }),
    buildTaskFlowAction({
      id: 'start_delivery',
      label: '提交并创建 PR',
      description: '将已实现结果提交到分支并创建 PR',
      enabled: canDeliver,
      disabledReason: isTaskImplemented(input.task)
        ? 'Delivery Agent 正在执行'
        : '只有实现完成后才能交付',
      stage: 'delivery',
      variant: 'primary',
    }),
    buildTaskFlowAction({
      id: 'accept_delivery',
      label: '验收完成',
      description: '确认交付结果并结束任务',
      enabled: canAcceptDelivery,
      disabledReason: '只有已交付任务可以验收完成',
      stage: 'delivery',
      variant: 'primary',
    }),
    buildTaskFlowAction({
      id: 'request_changes',
      label: '继续修改',
      description: '基于交付结果重新打开讨论',
      enabled: isTaskDelivered(input.task) || isTaskCompleted(input.task),
      disabledReason: '只有交付后才能发起继续修改',
      stage: 'delivery',
      variant: 'secondary',
    }),
    ...(isTaskCompleted(input.task)
      ? []
      : [
          buildTaskFlowAction({
            id: 'close_task',
            label: '关闭任务',
            description: '终止当前 Task 流程并保留历史记录',
            enabled: true,
            stage: getCurrentTaskFlowStageId(input),
            variant: 'danger',
          }),
        ]),
  ];
}

function getTaskFlowStageSummary(input: {
  stageId: TaskFlowStageId;
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  artifacts: TaskArtifactRecord[];
  agentStages: TaskAgentStageRecord[];
}): string {
  const agentStage =
    input.stageId === 'plan_discussion'
      ? getStageByAgentStage(input.agentStages, TASK_AGENT_STAGE.PLANNING)
      : input.stageId === 'implementation'
        ? getStageByAgentStage(
            input.agentStages,
            TASK_AGENT_STAGE.IMPLEMENTATION,
          )
        : input.stageId === 'delivery'
          ? getStageByAgentStage(input.agentStages, TASK_AGENT_STAGE.DELIVERY)
          : undefined;

  if (agentStage?.status === AGENT_RUN_STATUS.FAILED) {
    return `${agentStage.label}失败`;
  }
  if (agentStage?.status === AGENT_RUN_STATUS.RUNNING) {
    return agentStage.latestRun && isLongRunning(agentStage.latestRun)
      ? '运行时间较长'
      : '正在运行';
  }

  switch (input.stageId) {
    case 'ask':
      if (input.thread.status === THREAD_STATUS.ANSWERED) return '已回答';
      if (input.thread.status === THREAD_STATUS.WAITING_USER) return '待补充';
      return '咨询中';
    case 'requirements':
      return '任务目标和上下文已记录';
    case 'plan_discussion':
      if (input.openRound) return `开放反馈轮次 ${input.openRound.roundId}`;
      return input.currentPlan ? '计划已产出' : '等待计划输出';
    case 'plan_confirmation':
      return input.thread.status === THREAD_STATUS.AWAITING_APPROVAL
        ? '等待用户确认'
        : input.thread.approvedPlanId
          ? '计划已确认'
          : '尚未进入确认';
    case 'implementation':
      if (isTaskImplemented(input.task)) return '实现已完成';
      if (isPlanningApproved(input)) {
        const approvedPlan =
          input.currentPlan?.planId === input.thread.approvedPlanId
            ? input.currentPlan
            : null;
        const steps = approvedPlan
          ? findImplementationStepsArtifact(input, approvedPlan)
          : undefined;
        const approved = approvedPlan
          ? areImplementationStepsApproved(input, approvedPlan)
          : false;
        if (steps && !approved) return '等待确认实施步骤';
        if (approved) return '实施步骤已确认';
        return '等待启动实现';
      }
      return '等待计划批准';
    case 'delivery':
      if (isTaskDelivered(input.task)) return '结果已交付';
      if (isTaskImplemented(input.task)) return '等待交付';
      if (isTaskDelivering(input)) return '交付中';
      return '等待实现完成';
    case 'completed':
      if (isTaskCancelled(input.task)) return '任务已关闭';
      return isTaskCompleted(input.task) ? '任务已完成' : '等待验收';
    default:
      return TASK_FLOW_STAGE_LABELS[input.stageId];
  }
}

function buildTaskFlowStageDetails(input: {
  stageId: TaskFlowStageId;
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  plans: TaskPlanRevisionRecord[];
  artifacts: TaskArtifactRecord[];
  agentStages: TaskAgentStageRecord[];
}): string[] {
  const details: string[] = [];
  if (input.stageId === 'requirements') {
    details.push(`来源：${input.task.source}`);
    if (input.task.repoOwner && input.task.repoName) {
      details.push(`仓库：${input.task.repoOwner}/${input.task.repoName}`);
    }
  }
  if (input.stageId === 'ask') {
    details.push(`来源：${input.task.source}`);
    details.push(`消息数：${input.artifacts.length}`);
  }
  if (input.stageId === 'plan_discussion') {
    details.push(`计划版本数：${input.plans.length}`);
    if (input.openRound) {
      details.push(`反馈数：${input.openRound.feedbackArtifactIds.length}`);
    }
  }
  if (input.stageId === 'plan_confirmation' && input.currentPlan) {
    details.push(`当前计划：v${input.currentPlan.version}`);
  }
  if (input.stageId === 'implementation') {
    const stage = getStageByAgentStage(
      input.agentStages,
      TASK_AGENT_STAGE.IMPLEMENTATION,
    );
    const approvedPlan =
      input.currentPlan?.planId === input.thread.approvedPlanId
        ? input.currentPlan
        : null;
    const steps = approvedPlan
      ? findImplementationStepsArtifact(input, approvedPlan)
      : undefined;
    const approved = approvedPlan
      ? areImplementationStepsApproved(input, approvedPlan)
      : false;
    if (steps) details.push(`实施步骤：${steps.artifactId}`);
    if (approved) details.push('实施步骤已人工确认');
    if (stage?.latestRun) details.push(`最近运行：${stage.latestRun.runId}`);
    if (input.task.worktreePath)
      details.push(`工作目录：${input.task.worktreePath}`);
  }
  if (input.stageId === 'delivery') {
    if (input.task.branchName) details.push(`分支：${input.task.branchName}`);
    if (input.task.prUrl) details.push(`PR：${input.task.prUrl}`);
  }
  if (input.stageId === 'completed') {
    if (input.task.prUrl) details.push(`最终 PR：${input.task.prUrl}`);
    if (input.task.commitShas.length > 0) {
      details.push(`Commit：${input.task.commitShas.join(', ')}`);
    }
  }
  return details;
}

function buildTaskFlowStages(input: {
  currentStageId: TaskFlowStageId;
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  plans: TaskPlanRevisionRecord[];
  artifacts: TaskArtifactRecord[];
  agentStages: TaskAgentStageRecord[];
}): TaskFlowStage[] {
  if (input.task.currentWorkflowKind === WORKFLOW_KIND.ASK) {
    const state: TaskFlowStageState =
      input.thread.status === THREAD_STATUS.ANSWERED ? 'completed' : 'current';
    return [
      {
        id: 'ask',
        label: TASK_FLOW_STAGE_LABELS.ask,
        summary: getTaskFlowStageSummary({ stageId: 'ask', ...input }),
        state,
        details: buildTaskFlowStageDetails({ stageId: 'ask', ...input }),
        startedAt: input.task.createdAt,
        endedAt:
          input.thread.status === THREAD_STATUS.ANSWERED
            ? input.task.updatedAt
            : undefined,
      },
    ];
  }
  const currentIndex = TASK_FLOW_STAGE_ORDER.indexOf(input.currentStageId);
  const failedStage = isTaskCancelled(input.task)
    ? undefined
    : getLatestFailedAgentStage(input.agentStages);

  return TASK_FLOW_STAGE_ORDER.map((stageId, index) => {
    let state: TaskFlowStageState =
      index < currentIndex
        ? 'completed'
        : index === currentIndex
          ? 'current'
          : 'pending';
    let blocker: string | undefined;

    if (
      stageId === input.currentStageId &&
      failedStage &&
      ((stageId === 'plan_discussion' &&
        failedStage.stage === TASK_AGENT_STAGE.PLANNING) ||
        (stageId === 'implementation' &&
          failedStage.stage === TASK_AGENT_STAGE.IMPLEMENTATION) ||
        (stageId === 'delivery' &&
          failedStage.stage === TASK_AGENT_STAGE.DELIVERY))
    ) {
      state = 'blocked';
      blocker = failedStage.latestRun
        ? getAgentRunFailureSummary(failedStage.latestRun)
        : `${failedStage.label}失败`;
    } else {
      const runningStage =
        stageId === 'plan_discussion'
          ? getStageByAgentStage(input.agentStages, TASK_AGENT_STAGE.PLANNING)
          : stageId === 'implementation'
            ? getStageByAgentStage(
                input.agentStages,
                TASK_AGENT_STAGE.IMPLEMENTATION,
              )
            : stageId === 'delivery'
              ? getStageByAgentStage(
                  input.agentStages,
                  TASK_AGENT_STAGE.DELIVERY,
                )
              : undefined;
      if (
        stageId === input.currentStageId &&
        runningStage?.status === AGENT_RUN_STATUS.RUNNING &&
        runningStage.latestRun &&
        isLongRunning(runningStage.latestRun)
      ) {
        state = 'attention';
        blocker = '运行时间超过 30 分钟，可能需要确认运行状态或人工接管。';
      }
    }

    return {
      id: stageId,
      label: TASK_FLOW_STAGE_LABELS[stageId],
      summary: getTaskFlowStageSummary({ stageId, ...input }),
      state,
      blocker,
      details: buildTaskFlowStageDetails({ stageId, ...input }),
      startedAt: stageId === 'requirements' ? input.task.createdAt : undefined,
      endedAt:
        state === 'completed'
          ? stageId === 'requirements'
            ? input.thread.createdAt
            : input.task.updatedAt
          : undefined,
    };
  });
}

function buildTaskFlowEvents(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  artifacts: TaskArtifactRecord[];
  plans: TaskPlanRevisionRecord[];
  agentRuns: TaskAgentRunRecord[];
}): TaskFlowEvent[] {
  const events: TaskFlowEvent[] = [
    {
      eventId: `task:${input.task.taskId}`,
      type: 'task_created',
      stage: 'requirements',
      title: '任务已创建',
      summary: input.task.title,
      occurredAt: input.task.createdAt,
    },
  ];

  for (const artifact of input.artifacts) {
    if (artifact.type === ARTIFACT_TYPE.USER_MESSAGE) {
      events.push({
        eventId: artifact.artifactId,
        type: 'user_feedback',
        stage:
          input.thread.purpose === THREAD_PURPOSE.ASK
            ? 'ask'
            : 'plan_discussion',
        title: '用户补充反馈',
        summary: artifact.body.slice(0, 120),
        occurredAt: artifact.createdAt,
      });
    }
    if (artifact.type === ARTIFACT_TYPE.APPROVAL) {
      if (artifact.metadata.kind === IMPLEMENTATION_STEPS_APPROVAL_KIND) {
        events.push({
          eventId: artifact.artifactId,
          type: 'implementation_steps_approved',
          stage: 'implementation',
          title: '实施步骤已确认',
          summary: artifact.body,
          occurredAt: artifact.createdAt,
        });
        continue;
      }
      events.push({
        eventId: artifact.artifactId,
        type: 'plan_approved',
        stage: 'plan_confirmation',
        title: '计划已批准',
        summary: artifact.body,
        occurredAt: artifact.createdAt,
      });
    }
    if (artifact.type === ARTIFACT_TYPE.TASK_CLOSED) {
      const previousLifecycle =
        typeof artifact.metadata.previousLifecycle === 'string'
          ? artifact.metadata.previousLifecycle
          : undefined;
      const previousWorkflowKind =
        typeof artifact.metadata.previousWorkflowKind === 'string'
          ? artifact.metadata.previousWorkflowKind
          : undefined;
      const previousThreadStatus =
        typeof artifact.metadata.previousThreadStatus === 'string'
          ? artifact.metadata.previousThreadStatus
          : undefined;
      const reason =
        typeof artifact.metadata.reason === 'string'
          ? artifact.metadata.reason
          : undefined;
      events.push({
        eventId: artifact.artifactId,
        type: 'task_closed',
        stage: 'completed',
        title: '任务已关闭',
        summary: [
          previousLifecycle ? `关闭前生命周期：${previousLifecycle}` : '',
          previousWorkflowKind ? `工作流：${previousWorkflowKind}` : '',
          previousThreadStatus ? `线程：${previousThreadStatus}` : '',
          reason,
        ]
          .filter(Boolean)
          .join('；'),
        occurredAt: artifact.createdAt,
      });
    }
  }

  for (const plan of input.plans) {
    events.push({
      eventId: plan.planId,
      type: 'plan_revision',
      stage: 'plan_confirmation',
      title: `计划 v${plan.version}`,
      summary: plan.status,
      occurredAt: plan.createdAt,
    });
  }

  for (const run of input.agentRuns) {
    const stage =
      run.agentId === 'planner'
        ? 'plan_discussion'
        : run.agentId === 'delivery'
          ? 'delivery'
          : 'implementation';
    events.push({
      eventId: `${run.runId}:start`,
      type: 'agent_run_started',
      stage,
      title: `${run.agentId} 开始运行`,
      summary: `${run.provider} / ${run.runId}`,
      occurredAt: run.startedAt,
    });
    if (run.endedAt) {
      events.push({
        eventId: `${run.runId}:end`,
        type: getAgentRunEndEventType(run.status),
        stage,
        title: getAgentRunEndEventTitle(run),
        summary:
          run.status === AGENT_RUN_STATUS.FAILED
            ? getAgentRunFailureSummary(run)
            : run.status === AGENT_RUN_STATUS.CANCELLED
              ? run.error || '任务关闭时已取消运行'
              : undefined,
        occurredAt: run.endedAt,
      });
    }
  }

  if (input.task.prUrl) {
    events.push({
      eventId: `delivery:${input.task.taskId}`,
      type: 'delivery_updated',
      stage: 'delivery',
      title: '结果已交付',
      summary: input.task.prUrl,
      occurredAt: input.task.updatedAt,
    });
  }
  if (isTaskCompleted(input.task)) {
    events.push({
      eventId: `completed:${input.task.taskId}`,
      type: 'task_completed',
      stage: 'completed',
      title: '任务已完成',
      occurredAt: input.task.updatedAt,
    });
  }

  return events.sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt),
  );
}

function getAgentRunEndEventType(
  status: AgentRunStatus,
): Extract<
  TaskFlowEventType,
  'agent_run_failed' | 'agent_run_succeeded' | 'agent_run_cancelled'
> {
  if (status === AGENT_RUN_STATUS.FAILED) return 'agent_run_failed';
  if (status === AGENT_RUN_STATUS.CANCELLED) return 'agent_run_cancelled';
  return 'agent_run_succeeded';
}

function getAgentRunEndEventTitle(run: TaskAgentRunRecord): string {
  if (run.status === AGENT_RUN_STATUS.FAILED) return `${run.agentId} 运行失败`;
  if (run.status === AGENT_RUN_STATUS.CANCELLED)
    return `${run.agentId} 运行已取消`;
  return `${run.agentId} 运行完成`;
}

function buildTaskFlowSnapshot(input: {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  artifacts: TaskArtifactRecord[];
  plans: TaskPlanRevisionRecord[];
  agentRuns: TaskAgentRunRecord[];
  agentProgressEvents: TaskAgentProgressEventRecord[];
  agentStages: TaskAgentStageRecord[];
}): TaskFlowSnapshot {
  const currentStageId = getCurrentTaskFlowStageId(input);
  const isClosed = isTaskCancelled(input.task);
  const failedStage = isClosed
    ? undefined
    : getLatestFailedAgentStage(input.agentStages);
  const runningStage = isClosed
    ? undefined
    : input.agentStages.find(
        (stage) => stage.status === AGENT_RUN_STATUS.RUNNING,
      );
  const conclusion = buildTaskFlowConclusion({
    failedStage,
    runningStage,
    ...input,
  });
  const stages = buildTaskFlowStages({ currentStageId, ...input });
  const blockers = stages
    .map((stage) => stage.blocker)
    .filter((blocker): blocker is string => Boolean(blocker));

  if (!input.task.cwd && !input.task.worktreePath) {
    blockers.push('缺少工作目录，Agent 调度或人工接管可能无法定位仓库。');
  }
  if (!isClosed && failedStage?.manualResume?.reason) {
    blockers.push(failedStage.manualResume.reason);
  }

  return {
    currentStageId,
    conclusion: conclusion.conclusion,
    severity: conclusion.severity,
    stages,
    actions: buildTaskFlowActions(input),
    blockers: [...new Set(blockers)],
    events: buildTaskFlowEvents(input),
  };
}

function buildManualResume(
  provider?: string,
  cwd?: string,
  sessionId?: string,
): TaskAgentManualResume {
  if (!cwd) {
    return {
      available: false,
      reason: '缺少可接管的工作目录',
    };
  }

  const cdCommand = `cd ${shellQuote(cwd)}`;
  if (provider === 'codex') {
    return sessionId
      ? {
          available: true,
          cwd,
          sessionId,
          command: `${cdCommand}\ncodex resume ${shellQuote(sessionId)}`,
        }
      : {
          available: true,
          cwd,
          command: `${cdCommand}\ncodex`,
          reason: '未记录 Codex 会话 ID，只能从工作目录手动接管',
        };
  }

  if (provider === 'claude') {
    return sessionId
      ? {
          available: true,
          cwd,
          sessionId,
          command: `${cdCommand}\nclaude --resume ${shellQuote(sessionId)}`,
        }
      : {
          available: true,
          cwd,
          command: `${cdCommand}\nclaude`,
          reason: '未记录 Claude 会话 ID，只能从工作目录手动接管',
        };
  }

  return {
    available: true,
    cwd,
    command: cdCommand,
    reason: provider
      ? `${provider} 暂无自动恢复命令，请在工作目录中手动处理`
      : '暂无可恢复的 editor 会话，请在工作目录中手动处理',
  };
}

function getActiveThreadRow(taskId: string): Result<TaskThreadRow | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const row = dbRes.data
      .prepare(
        `
          SELECT tt.*
          FROM task_threads tt
          JOIN task_items ti ON ti.active_thread_id = tt.thread_id
          WHERE ti.task_id = ?
        `,
      )
      .get(taskId) as TaskThreadRow | null;
    return success(row);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`读取 Task Thread 失败: ${message}`);
  }
}

function insertArtifact(input: {
  taskId: string;
  threadId: string;
  type: ArtifactType;
  role: ArtifactRole;
  body: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}): TaskArtifactRecord {
  const dbRes = getDb();
  if (!dbRes.success) throw new Error(dbRes.error);

  const artifactId = generateId('art');
  dbRes.data
    .prepare(
      `
        INSERT INTO task_artifacts (
          artifact_id, task_id, thread_id, type, role, body, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      artifactId,
      input.taskId,
      input.threadId,
      input.type,
      input.role,
      input.body,
      JSON.stringify(input.metadata || {}),
      input.createdAt,
    );

  return {
    artifactId,
    taskId: input.taskId,
    threadId: input.threadId,
    type: input.type,
    role: input.role,
    body: input.body,
    metadata: input.metadata || {},
    attachments: [],
    createdAt: input.createdAt,
  };
}

function insertTaskAttachmentRows(input: {
  taskId: string;
  threadId: string;
  artifactId: string;
  attachments: PreparedTaskAttachment[];
  createdAt: string;
}) {
  const dbRes = getDb();
  if (!dbRes.success) throw new Error(dbRes.error);
  const statement = dbRes.data.prepare(
    `
      INSERT INTO task_attachments (
        attachment_id, task_id, thread_id, artifact_id, kind, original_name,
        mime_type, size_bytes, sha256, relative_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );
  for (const attachment of input.attachments) {
    statement.run(
      attachment.attachmentId,
      input.taskId,
      input.threadId,
      input.artifactId,
      attachment.kind,
      attachment.originalName,
      attachment.mimeType,
      attachment.sizeBytes,
      attachment.sha256,
      attachment.relativePath,
      input.createdAt,
    );
  }
}

function ensureTaskIsOpen(
  snapshot: TaskPlanningSnapshot,
  action: string,
): Result<void> {
  return snapshot.task.lifecycle === TASK_LIFECYCLE.CANCELLED
    ? failure(`Task 已关闭，不能${action}`)
    : success(undefined);
}

function ensureTaskCanRecordAgentResult(taskId: string): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const row = dbRes.data
      .prepare('SELECT * FROM task_items WHERE task_id = ?')
      .get(taskId) as TaskItemRow | null;
    if (!row) return failure(`Task 不存在: ${taskId}`);
    if (normalizeTaskLifecycle(row.lifecycle) === TASK_LIFECYCLE.CANCELLED) {
      return failure('Task 已关闭，不能记录 Agent Result');
    }
    return success(undefined);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`检查 Task 状态失败: ${message}`);
  }
}

export function closeTask(
  taskId: string,
  reason?: string,
): Result<TaskPlanningSnapshot> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${taskId}`);
  if (snapshot.task.lifecycle === TASK_LIFECYCLE.COMPLETED) {
    return failure('已完成 Task 不能关闭');
  }
  if (snapshot.task.lifecycle === TASK_LIFECYCLE.CANCELLED)
    return success(snapshot);

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const now = iso_timestamp();
    const closeReason = reason?.trim();
    const runningRuns = snapshot.agentRuns.filter(
      (run) => run.status === AGENT_RUN_STATUS.RUNNING,
    );

    const txn = db.transaction(() => {
      insertArtifact({
        taskId: snapshot.task.taskId,
        threadId: snapshot.thread.threadId,
        type: ARTIFACT_TYPE.TASK_CLOSED,
        role: ARTIFACT_ROLE.SYSTEM,
        body: closeReason
          ? `任务已关闭：${closeReason}`
          : '任务已关闭，不再继续推进。',
        metadata: {
          previousLifecycle: snapshot.task.lifecycle,
          previousWorkflowKind: snapshot.task.currentWorkflowKind,
          previousThreadStatus: snapshot.thread.status,
          reason: closeReason || null,
          closedAt: now,
        },
        createdAt: now,
      });

      if (snapshot.openRound) {
        db.prepare(
          `
            UPDATE task_feedback_rounds
            SET status = ?, resolved_at = ?
            WHERE round_id = ?
          `,
        ).run(ROUND_STATUS.CLOSED, now, snapshot.openRound.roundId);
      }

      db.prepare(
        `
          UPDATE task_threads
          SET open_round_id = NULL, updated_at = ?
          WHERE thread_id = ?
        `,
      ).run(now, snapshot.thread.threadId);

      for (const run of runningRuns) {
        db.prepare(
          `
            UPDATE task_agent_runs
            SET status = ?,
                output_artifact_ids = ?,
                error = ?,
                ended_at = ?
            WHERE run_id = ? AND status = ?
          `,
        ).run(
          AGENT_RUN_STATUS.CANCELLED,
          JSON.stringify(run.outputArtifactIds),
          '任务已关闭，运行已取消。',
          now,
          run.runId,
          AGENT_RUN_STATUS.RUNNING,
        );
      }

      db.prepare(
        `
          UPDATE task_items
          SET lifecycle = ?, updated_at = ?
          WHERE task_id = ?
        `,
      ).run(TASK_LIFECYCLE.CANCELLED, now, snapshot.task.taskId);
    });

    txn();
    const refreshedSnapshotRes = readTaskPlanningSnapshot(taskId);
    if (!refreshedSnapshotRes.success) return refreshedSnapshotRes;
    return refreshedSnapshotRes.data
      ? success(refreshedSnapshotRes.data)
      : failure(`Task ${taskId} 关闭后读取快照失败`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`关闭 Task 失败: ${message}`);
  }
}

export function createPlanningTask(
  input: CreatePlanningTaskInput,
): Result<TaskPlanningSnapshot> {
  const title = input.title.trim();
  const body =
    input.body.trim() ||
    (input.attachments?.length ? '（用户上传了图片）' : '');
  if (!title) return failure('Task 标题不能为空');
  if (!body) return failure('Task 内容不能为空');

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;
  const taskId = generateId('task');
  const threadId = generateId('thread');
  const workflowKind = input.workflowKind || WORKFLOW_KIND.ASK;
  const preparedAttachmentsRes = prepareTaskImageAttachments({
    task: {
      taskId,
      repoOwner: input.repoOwner,
      repoName: input.repoName,
    },
    uploads: input.attachments,
  });
  if (!preparedAttachmentsRes.success) return preparedAttachmentsRes;
  const preparedAttachments = preparedAttachmentsRes.data;

  try {
    const now = iso_timestamp();
    const hasLegacyStatusColumn = hasLegacyTaskStatusColumn(db);

    const txn = db.transaction(() => {
      let seq: number | null = null;
      if (input.repoOwner && input.repoName) {
        const maxRow = db
          .prepare(
            'SELECT MAX(seq) AS max_seq FROM task_items WHERE repo_owner = ? AND repo_name = ?',
          )
          .get(input.repoOwner, input.repoName) as
          | { max_seq: number | null }
          | undefined;
        seq = (maxRow?.max_seq ?? 0) + 1;
      }

      if (hasLegacyStatusColumn) {
        db.prepare(
          `
            INSERT INTO task_items (
              task_id, title, body, source, status, active_thread_id,
              repo_owner, repo_name, cwd, seq, execution_mode, lifecycle,
              current_workflow_kind, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          taskId,
          title,
          body,
          input.source || 'web',
          TASK_STATUS.PLANNING,
          threadId,
          input.repoOwner || null,
          input.repoName || null,
          input.cwd || null,
          seq,
          input.executionMode || TASK_EXECUTION_MODE.MANUAL,
          TASK_LIFECYCLE.OPEN,
          workflowKind,
          now,
          now,
        );
      } else {
        db.prepare(
          `
            INSERT INTO task_items (
              task_id, title, body, source, active_thread_id,
              repo_owner, repo_name, cwd, seq, execution_mode, lifecycle,
              current_workflow_kind, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          taskId,
          title,
          body,
          input.source || 'web',
          threadId,
          input.repoOwner || null,
          input.repoName || null,
          input.cwd || null,
          seq,
          input.executionMode || TASK_EXECUTION_MODE.MANUAL,
          TASK_LIFECYCLE.OPEN,
          workflowKind,
          now,
          now,
        );
      }

      db.prepare(
        `
          INSERT INTO task_threads (
            thread_id, task_id, purpose, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      ).run(
        threadId,
        taskId,
        workflowKind === WORKFLOW_KIND.PLANNING
          ? THREAD_PURPOSE.PLANNING
          : THREAD_PURPOSE.ASK,
        workflowKind === WORKFLOW_KIND.PLANNING
          ? THREAD_STATUS.DRAFTING
          : THREAD_STATUS.ACTIVE,
        now,
        now,
      );

      const artifact = insertArtifact({
        taskId,
        threadId,
        type: ARTIFACT_TYPE.USER_MESSAGE,
        role: ARTIFACT_ROLE.USER,
        body,
        metadata: {
          kind: 'initial_request',
          repoOwner: input.repoOwner,
          repoName: input.repoName,
          cwd: input.cwd,
          attachmentCount: preparedAttachments.length,
        },
        createdAt: now,
      });
      insertTaskAttachmentRows({
        taskId,
        threadId,
        artifactId: artifact.artifactId,
        attachments: preparedAttachments,
        createdAt: now,
      });
    });

    txn();
    const snapshot = readTaskPlanningSnapshot(taskId);
    return snapshot.success && snapshot.data
      ? success(snapshot.data)
      : failure('创建 Task 后读取快照失败');
  } catch (error: unknown) {
    cleanupPreparedTaskAttachments(preparedAttachments);
    const message = error instanceof Error ? error.message : String(error);
    return failure(`创建 Task 失败: ${message}`);
  }
}

export function updatePlanningTaskTitle(
  input: UpdatePlanningTaskTitleInput,
): Result<TaskPlanningSnapshot | null> {
  const title = input.title.trim();
  if (!title) return failure('Task 标题不能为空');

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const now = iso_timestamp();
    db.prepare(
      'UPDATE task_items SET title = ?, updated_at = ? WHERE task_id = ?',
    ).run(title, now, input.taskId);
    return readTaskPlanningSnapshot(input.taskId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`更新 Task 标题失败: ${message}`);
  }
}

export function readTaskPlanningSnapshot(
  taskId: string,
  options: ReadTaskPlanningSnapshotOptions = {},
): Result<TaskPlanningSnapshot | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const taskRow = db
      .prepare('SELECT * FROM task_items WHERE task_id = ?')
      .get(taskId) as TaskItemRow | null;
    if (!taskRow) return success(null);

    const threadRow = db
      .prepare('SELECT * FROM task_threads WHERE thread_id = ? AND task_id = ?')
      .get(taskRow.active_thread_id, taskId) as TaskThreadRow | null;
    if (!threadRow) {
      return failure(`Task ${taskId} 缺少 active planning thread`);
    }

    const currentPlanRow = threadRow.current_plan_id
      ? (db
          .prepare(
            'SELECT * FROM task_plan_revisions WHERE plan_id = ? AND thread_id = ?',
          )
          .get(
            threadRow.current_plan_id,
            threadRow.thread_id,
          ) as TaskPlanRevisionRow | null)
      : null;

    const openRoundRow = threadRow.open_round_id
      ? (db
          .prepare(
            'SELECT * FROM task_feedback_rounds WHERE round_id = ? AND thread_id = ?',
          )
          .get(
            threadRow.open_round_id,
            threadRow.thread_id,
          ) as TaskFeedbackRoundRow | null)
      : null;

    const artifactRows = db
      .prepare(
        'SELECT * FROM task_artifacts WHERE thread_id = ? ORDER BY created_at ASC',
      )
      .all(threadRow.thread_id) as TaskArtifactRow[];
    const planRows = db
      .prepare(
        'SELECT * FROM task_plan_revisions WHERE thread_id = ? ORDER BY version ASC',
      )
      .all(threadRow.thread_id) as TaskPlanRevisionRow[];
    const bindingRows = db
      .prepare('SELECT * FROM task_agent_bindings WHERE thread_id = ?')
      .all(threadRow.thread_id) as TaskAgentBindingRow[];
    const runRows = db
      .prepare(
        'SELECT * FROM task_agent_runs WHERE thread_id = ? ORDER BY started_at ASC',
      )
      .all(threadRow.thread_id) as TaskAgentRunRow[];
    const progressRows = db
      .prepare(
        'SELECT * FROM task_agent_progress_events WHERE thread_id = ? ORDER BY created_at ASC',
      )
      .all(threadRow.thread_id) as TaskAgentProgressEventRow[];
    const sessionEventRows =
      options.includeSessionEvents === false
        ? []
        : (db
            .prepare(
              `
                SELECT * FROM (
                  SELECT * FROM task_agent_session_events
                  WHERE thread_id = ?
                  ORDER BY created_at DESC
                  LIMIT 200
                ) ORDER BY created_at ASC
              `,
            )
            .all(threadRow.thread_id) as TaskAgentSessionEventRow[]);
    const mappedTask = mapTask(taskRow);
    const mappedThread = mapThread(threadRow);
    const currentPlan = currentPlanRow ? mapPlan(currentPlanRow) : null;
    const openRound = openRoundRow ? mapRound(openRoundRow) : null;
    const attachmentRows = db
      .prepare(
        'SELECT * FROM task_attachments WHERE thread_id = ? ORDER BY created_at ASC',
      )
      .all(threadRow.thread_id) as TaskAttachmentRow[];
    const attachmentsByArtifact = groupAttachmentsByArtifact(
      attachmentRows,
      mappedTask,
    );
    const artifacts = artifactRows.map((row) => ({
      ...mapArtifact(row),
      attachments: attachmentsByArtifact.get(row.artifact_id) || [],
    }));
    const plans = planRows.map(mapPlan);
    const agentBindings = bindingRows.map(mapBinding);
    const agentRuns = runRows.map(mapRun);
    const agentProgressEvents = progressRows.map(mapProgressEvent);
    const agentSessionEvents = sessionEventRows.map(mapSessionEvent);
    const agentStages = buildTaskAgentStages(
      agentRuns,
      agentBindings,
      mappedTask,
    );
    const workflowView = applyWorkflowView({
      task: mappedTask,
      thread: mappedThread,
      currentPlan,
      openRound,
      agentStages,
    });
    const task = workflowView.task;
    const thread = workflowView.thread;

    return success({
      task,
      thread,
      display: workflowView.display,
      currentPlan,
      openRound,
      artifacts,
      plans,
      agentRuns,
      agentProgressEvents,
      agentSessionEvents,
      agentStages,
      flow: buildTaskFlowSnapshot({
        task,
        thread,
        currentPlan,
        openRound,
        artifacts,
        plans,
        agentRuns,
        agentProgressEvents,
        agentStages,
      }),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`读取 Task Planning 快照失败: ${message}`);
  }
}

function groupAttachmentsByArtifact(
  rows: TaskAttachmentRow[],
  task: TaskItemRecord,
): Map<string, TaskAttachmentRecord[]> {
  const grouped = new Map<string, TaskAttachmentRecord[]>();
  for (const row of rows) {
    const existing = grouped.get(row.artifact_id) || [];
    existing.push(mapTaskAttachment(row, task));
    grouped.set(row.artifact_id, existing);
  }
  return grouped;
}

export function listTaskPlanningSnapshots(
  limit = 100,
  filter: { repoOwner?: string; repoName?: string } = {},
): Result<TaskPlanningSnapshot[]> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows =
      filter.repoOwner && filter.repoName
        ? (db
            .prepare(
              `SELECT task_id FROM task_items
               WHERE repo_owner = ? AND repo_name = ?
               ORDER BY updated_at DESC
               LIMIT ?`,
            )
            .all(filter.repoOwner, filter.repoName, safeLimit) as TaskIdRow[])
        : (db
            .prepare(
              'SELECT task_id FROM task_items ORDER BY updated_at DESC LIMIT ?',
            )
            .all(safeLimit) as TaskIdRow[]);
    const snapshots: TaskPlanningSnapshot[] = [];

    for (const row of rows) {
      const snapshotRes = readTaskPlanningSnapshot(row.task_id, {
        includeSessionEvents: false,
      });
      if (!snapshotRes.success) return snapshotRes;
      if (snapshotRes.data) snapshots.push(snapshotRes.data);
    }

    return success(snapshots);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`列出 Task Planning 快照失败: ${message}`);
  }
}

export function submitTaskMessage(input: SubmitTaskMessageInput): Result<{
  artifact: TaskArtifactRecord;
  round: TaskFeedbackRoundRecord | null;
}> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;
  const body =
    input.body.trim() ||
    (input.attachments?.length ? '（用户上传了图片）' : '');
  if (!body) return failure('用户消息不能为空');

  const threadRes = getActiveThreadRow(input.taskId);
  if (!threadRes.success) return threadRes;
  const thread = threadRes.data;
  if (!thread)
    return failure(`Task 不存在或缺少 active thread: ${input.taskId}`);
  const taskRow = db
    .prepare('SELECT * FROM task_items WHERE task_id = ?')
    .get(input.taskId) as TaskItemRow | null;
  if (!taskRow) return failure(`Task 不存在: ${input.taskId}`);
  const task = mapTask(taskRow);
  if (task.lifecycle === TASK_LIFECYCLE.CANCELLED) {
    return failure('Task 已关闭，不能继续讨论');
  }
  if (thread.status === THREAD_STATUS.APPROVED) {
    if (!task.prUrl && task.lifecycle !== TASK_LIFECYCLE.COMPLETED) {
      return failure('当前 Planning 已批准，不能继续提交反馈');
    }
  }
  const preparedAttachmentsRes = prepareTaskImageAttachments({
    task: {
      taskId: thread.task_id,
      repoOwner: taskRow.repo_owner || undefined,
      repoName: taskRow.repo_name || undefined,
    },
    uploads: input.attachments,
  });
  if (!preparedAttachmentsRes.success) return preparedAttachmentsRes;
  const preparedAttachments = preparedAttachmentsRes.data;

  try {
    const now = iso_timestamp();
    let createdArtifact: TaskArtifactRecord | null = null;
    let roundResult: TaskFeedbackRoundRecord | null = null;

    const txn = db.transaction(() => {
      createdArtifact = insertArtifact({
        taskId: thread.task_id,
        threadId: thread.thread_id,
        type: ARTIFACT_TYPE.USER_MESSAGE,
        role: ARTIFACT_ROLE.USER,
        body,
        metadata: thread.current_plan_id
          ? {
              kind: 'planning_feedback',
              basedOnPlanId: thread.current_plan_id,
              attachmentCount: preparedAttachments.length,
            }
          : {
              kind: 'additional_context',
              attachmentCount: preparedAttachments.length,
            },
        createdAt: now,
      });
      insertTaskAttachmentRows({
        taskId: thread.task_id,
        threadId: thread.thread_id,
        artifactId: createdArtifact.artifactId,
        attachments: preparedAttachments,
        createdAt: now,
      });

      if (!thread.current_plan_id || !createdArtifact) {
        if (thread.purpose === THREAD_PURPOSE.ASK) {
          db.prepare(
            'UPDATE task_threads SET status = ?, updated_at = ? WHERE thread_id = ?',
          ).run(THREAD_STATUS.ACTIVE, now, thread.thread_id);
        } else {
          db.prepare(
            'UPDATE task_threads SET updated_at = ? WHERE thread_id = ?',
          ).run(now, thread.thread_id);
        }
        db.prepare(
          'UPDATE task_items SET updated_at = ? WHERE task_id = ?',
        ).run(now, thread.task_id);
        return;
      }

      let roundRow = thread.open_round_id
        ? (db
            .prepare(
              'SELECT * FROM task_feedback_rounds WHERE round_id = ? AND thread_id = ?',
            )
            .get(
              thread.open_round_id,
              thread.thread_id,
            ) as TaskFeedbackRoundRow | null)
        : null;

      if (!roundRow) {
        const roundId = generateId('round');
        const ids = [createdArtifact.artifactId];
        db.prepare(
          `
            INSERT INTO task_feedback_rounds (
              round_id, task_id, thread_id, based_on_plan_id, feedback_artifact_ids,
              status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          roundId,
          thread.task_id,
          thread.thread_id,
          thread.current_plan_id,
          JSON.stringify(ids),
          ROUND_STATUS.OPEN,
          now,
        );
        db.prepare(
          `
            UPDATE task_threads
            SET status = ?, open_round_id = ?, updated_at = ?
            WHERE thread_id = ?
          `,
        ).run(THREAD_STATUS.DISCUSSING, roundId, now, thread.thread_id);
        roundRow = {
          round_id: roundId,
          task_id: thread.task_id,
          thread_id: thread.thread_id,
          based_on_plan_id: thread.current_plan_id,
          feedback_artifact_ids: JSON.stringify(ids),
          status: ROUND_STATUS.OPEN,
          resolution: null,
          produced_plan_id: null,
          created_at: now,
          resolved_at: null,
        };
      } else {
        const ids = parseStringArray(roundRow.feedback_artifact_ids);
        ids.push(createdArtifact.artifactId);
        db.prepare(
          `
            UPDATE task_feedback_rounds
            SET feedback_artifact_ids = ?, status = ?
            WHERE round_id = ?
          `,
        ).run(JSON.stringify(ids), ROUND_STATUS.OPEN, roundRow.round_id);
        db.prepare(
          `
            UPDATE task_threads
            SET status = ?, updated_at = ?
            WHERE thread_id = ?
          `,
        ).run(THREAD_STATUS.DISCUSSING, now, thread.thread_id);
        roundRow = {
          ...roundRow,
          feedback_artifact_ids: JSON.stringify(ids),
          status: ROUND_STATUS.OPEN,
        };
      }

      db.prepare('UPDATE task_items SET updated_at = ? WHERE task_id = ?').run(
        now,
        thread.task_id,
      );
      if (thread.status === THREAD_STATUS.APPROVED) {
        db.prepare(
          `
            UPDATE task_items
            SET lifecycle = ?, current_workflow_kind = ?, updated_at = ?
            WHERE task_id = ?
          `,
        ).run(TASK_LIFECYCLE.OPEN, WORKFLOW_KIND.PLANNING, now, thread.task_id);
      }
      roundResult = mapRound(roundRow);
    });

    txn();
    if (!createdArtifact) return failure('提交消息后缺少 artifact');
    return success({ artifact: createdArtifact, round: roundResult });
  } catch (error: unknown) {
    cleanupPreparedTaskAttachments(preparedAttachments);
    const message = error instanceof Error ? error.message : String(error);
    return failure(`提交 Task 消息失败: ${message}`);
  }
}

export function publishTaskPlanRevision(
  input: PublishTaskPlanInput,
): Result<TaskPlanRevisionRecord> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;
  const body = input.body.trim();
  if (!body) return failure('Plan 内容不能为空');

  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${input.taskId}`);
  const openRes = ensureTaskIsOpen(snapshot, '发布新版 Plan');
  if (!openRes.success) return openRes;
  if (snapshot.thread.status === THREAD_STATUS.APPROVED) {
    return failure('当前 Planning 已批准，不能发布新版 Plan');
  }
  if (snapshot.currentPlan && !snapshot.openRound) {
    return failure('当前没有待处理反馈，不能覆盖现有 Plan');
  }

  try {
    const now = iso_timestamp();
    let plan: TaskPlanRevisionRecord | null = null;

    const txn = db.transaction(() => {
      const nextVersion = snapshot.plans.length + 1;
      const planId = generateId('plan');
      const artifact = insertArtifact({
        taskId: snapshot.task.taskId,
        threadId: snapshot.thread.threadId,
        type: ARTIFACT_TYPE.PLAN_REVISION,
        role: ARTIFACT_ROLE.AGENT,
        body,
        metadata: {
          agentId: input.agentId || 'planner',
          version: nextVersion,
          basedOnPlanId: snapshot.currentPlan?.planId,
          roundId: snapshot.openRound?.roundId,
        },
        createdAt: now,
      });

      db.prepare(
        `
          UPDATE task_plan_revisions
          SET status = ?
          WHERE thread_id = ? AND status = ?
        `,
      ).run(
        PLAN_STATUS.SUPERSEDED,
        snapshot.thread.threadId,
        PLAN_STATUS.ACTIVE,
      );

      db.prepare(
        `
          INSERT INTO task_plan_revisions (
            plan_id, task_id, thread_id, version, based_on_plan_id, status,
            artifact_id, body, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        planId,
        snapshot.task.taskId,
        snapshot.thread.threadId,
        nextVersion,
        snapshot.currentPlan?.planId || null,
        PLAN_STATUS.ACTIVE,
        artifact.artifactId,
        body,
        now,
      );

      if (snapshot.openRound) {
        db.prepare(
          `
            UPDATE task_feedback_rounds
            SET status = ?, resolution = ?, produced_plan_id = ?, resolved_at = ?
            WHERE round_id = ?
          `,
        ).run(
          ROUND_STATUS.RESOLVED,
          ROUND_RESOLUTION.REVISE_PLAN,
          planId,
          now,
          snapshot.openRound.roundId,
        );
      }

      db.prepare(
        `
          UPDATE task_threads
          SET status = ?, current_plan_id = ?, open_round_id = NULL, updated_at = ?
          WHERE thread_id = ?
        `,
      ).run(
        THREAD_STATUS.AWAITING_APPROVAL,
        planId,
        now,
        snapshot.thread.threadId,
      );
      db.prepare(
        'UPDATE task_items SET type = COALESCE(?, type), updated_at = ? WHERE task_id = ?',
      ).run(input.type || null, now, snapshot.task.taskId);

      plan = {
        planId,
        taskId: snapshot.task.taskId,
        threadId: snapshot.thread.threadId,
        version: nextVersion,
        basedOnPlanId: snapshot.currentPlan?.planId,
        status: PLAN_STATUS.ACTIVE,
        artifactId: artifact.artifactId,
        body,
        createdAt: now,
      };
    });

    txn();
    return plan ? success(plan) : failure('发布 Plan 后缺少结果');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`发布 Task Plan 失败: ${message}`);
  }
}

export function publishPlanningUpdate(
  input: PublishPlanningUpdateInput,
): Result<TaskArtifactRecord> {
  const body = input.body.trim();
  if (!body) return failure('Planning Update 内容不能为空');

  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${input.taskId}`);
  const openRes = ensureTaskIsOpen(snapshot, '发布 Update');
  if (!openRes.success) return openRes;
  if (snapshot.thread.status === THREAD_STATUS.APPROVED) {
    return failure('当前 Planning 已批准，不能发布 Update');
  }
  if (snapshot.currentPlan && !snapshot.openRound)
    return failure('当前没有待处理反馈，无法发布 Update');

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const now = iso_timestamp();
    let artifact: TaskArtifactRecord | null = null;

    const txn = db.transaction(() => {
      artifact = insertArtifact({
        taskId: snapshot.task.taskId,
        threadId: snapshot.thread.threadId,
        type: ARTIFACT_TYPE.PLANNING_UPDATE,
        role: ARTIFACT_ROLE.AGENT,
        body,
        metadata: {
          agentId: input.agentId || 'planner',
          roundId: snapshot.openRound?.roundId,
          basedOnPlanId: snapshot.currentPlan?.planId,
          kind:
            input.kind ||
            (snapshot.currentPlan ? 'answer_only' : 'pre_plan_clarification'),
        },
        createdAt: now,
      });

      if (snapshot.openRound) {
        db.prepare(
          `
            UPDATE task_feedback_rounds
            SET status = ?, resolution = ?, resolved_at = ?
            WHERE round_id = ?
          `,
        ).run(
          ROUND_STATUS.RESOLVED,
          ROUND_RESOLUTION.ANSWER_ONLY,
          now,
          snapshot.openRound.roundId,
        );
        db.prepare(
          `
            UPDATE task_threads
            SET status = ?, open_round_id = NULL, updated_at = ?
            WHERE thread_id = ?
          `,
        ).run(THREAD_STATUS.AWAITING_APPROVAL, now, snapshot.thread.threadId);
      } else if (snapshot.task.currentWorkflowKind === WORKFLOW_KIND.ASK) {
        db.prepare(
          `
            UPDATE task_threads
            SET status = ?, updated_at = ?
            WHERE thread_id = ?
          `,
        ).run(THREAD_STATUS.ANSWERED, now, snapshot.thread.threadId);
      } else {
        db.prepare(
          `
            UPDATE task_threads
            SET status = ?, updated_at = ?
            WHERE thread_id = ?
          `,
        ).run(THREAD_STATUS.DISCUSSING, now, snapshot.thread.threadId);
      }

      db.prepare('UPDATE task_items SET updated_at = ? WHERE task_id = ?').run(
        now,
        snapshot.task.taskId,
      );
    });

    txn();
    return artifact ? success(artifact) : failure('发布 Update 后缺少结果');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`发布 Planning Update 失败: ${message}`);
  }
}

export function requestTaskPlan(taskId: string): Result<void> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${taskId}`);
  const openRes = ensureTaskIsOpen(snapshot, '转为计划');
  if (!openRes.success) return openRes;
  if (snapshot.task.currentWorkflowKind !== WORKFLOW_KIND.ASK) {
    return success(undefined);
  }

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const now = iso_timestamp();
    const txn = dbRes.data.transaction(() => {
      dbRes.data
        .prepare(
          `
            UPDATE task_items
            SET current_workflow_kind = ?, lifecycle = ?, updated_at = ?
            WHERE task_id = ?
          `,
        )
        .run(WORKFLOW_KIND.PLANNING, TASK_LIFECYCLE.OPEN, now, taskId);
      dbRes.data
        .prepare(
          `
            UPDATE task_threads
            SET purpose = ?, status = ?, updated_at = ?
            WHERE thread_id = ?
          `,
        )
        .run(
          THREAD_PURPOSE.PLANNING,
          THREAD_STATUS.DRAFTING,
          now,
          snapshot.thread.threadId,
        );
    });
    txn();
    return success(undefined);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`转为计划失败: ${message}`);
  }
}

export function recordTaskAgentResult(
  input: RecordTaskAgentResultInput,
): Result<TaskArtifactRecord> {
  const body = input.body.trim();
  if (!body) return failure('Agent Result 内容不能为空');
  const openRes = ensureTaskCanRecordAgentResult(input.taskId);
  if (!openRes.success) return openRes;

  try {
    const artifact = insertArtifact({
      taskId: input.taskId,
      threadId: input.threadId,
      type: ARTIFACT_TYPE.AGENT_RESULT,
      role: ARTIFACT_ROLE.AGENT,
      body,
      metadata: {
        agentId: input.agentId || 'agent',
        provider: input.provider || 'unknown',
        runId: input.runId,
        ...(input.metadata || {}),
      },
      createdAt: iso_timestamp(),
    });
    return success(artifact);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`记录 Agent Result 失败: ${message}`);
  }
}

export function approveCurrentTaskPlan(
  taskId: string,
): Result<TaskPlanRevisionRecord> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${taskId}`);
  const openRes = ensureTaskIsOpen(snapshot, '批准计划');
  if (!openRes.success) return openRes;
  if (!snapshot.currentPlan) return failure('当前没有可批准的正式 Plan');
  if (snapshot.openRound) {
    return failure(`当前仍有待处理反馈轮次: ${snapshot.openRound.roundId}`);
  }
  if (snapshot.currentPlan.status !== PLAN_STATUS.ACTIVE) {
    return failure('只能批准当前 active Plan');
  }

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const now = iso_timestamp();

    const txn = db.transaction(() => {
      insertArtifact({
        taskId: snapshot.task.taskId,
        threadId: snapshot.thread.threadId,
        type: ARTIFACT_TYPE.APPROVAL,
        role: ARTIFACT_ROLE.USER,
        body: `Approved Plan v${snapshot.currentPlan?.version}`,
        metadata: { planId: snapshot.currentPlan?.planId },
        createdAt: now,
      });
      db.prepare(
        'UPDATE task_plan_revisions SET status = ? WHERE plan_id = ?',
      ).run(PLAN_STATUS.APPROVED, snapshot.currentPlan?.planId);
      db.prepare(
        `
          UPDATE task_threads
          SET status = ?, approved_plan_id = ?, updated_at = ?
          WHERE thread_id = ?
        `,
      ).run(
        THREAD_STATUS.APPROVED,
        snapshot.currentPlan?.planId,
        now,
        snapshot.thread.threadId,
      );
      db.prepare(
        `
          UPDATE task_items
          SET lifecycle = ?, current_workflow_kind = ?, updated_at = ?
          WHERE task_id = ?
        `,
      ).run(
        TASK_LIFECYCLE.READY,
        WORKFLOW_KIND.PLANNING,
        now,
        snapshot.task.taskId,
      );
    });

    txn();
    return success({
      ...snapshot.currentPlan,
      status: PLAN_STATUS.APPROVED,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`批准 Task Plan 失败: ${message}`);
  }
}

export function approveTaskImplementationSteps(
  taskId: string,
): Result<TaskArtifactRecord> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${taskId}`);
  const openRes = ensureTaskIsOpen(snapshot, '确认实施步骤');
  if (!openRes.success) return openRes;

  const approvedPlan = snapshot.plans.find(
    (plan) =>
      plan.planId === snapshot.thread.approvedPlanId &&
      plan.status === PLAN_STATUS.APPROVED,
  );
  if (!approvedPlan)
    return failure('当前 Task 没有已批准方案，不能确认实施步骤');

  const steps = findImplementationStepsArtifact(snapshot, approvedPlan);
  if (!steps) return failure('当前 Task 还没有可确认的实施步骤');

  const existingApproval = findImplementationStepsApprovalArtifact(
    snapshot,
    approvedPlan,
  );
  if (existingApproval?.metadata.stepsArtifactId === steps.artifactId) {
    return success(existingApproval);
  }

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const now = iso_timestamp();
    let artifact: TaskArtifactRecord | null = null;
    const txn = dbRes.data.transaction(() => {
      artifact = insertArtifact({
        taskId: snapshot.task.taskId,
        threadId: snapshot.thread.threadId,
        type: ARTIFACT_TYPE.APPROVAL,
        role: ARTIFACT_ROLE.USER,
        body: `Approved Implementation Steps for Plan v${approvedPlan.version}`,
        metadata: {
          kind: IMPLEMENTATION_STEPS_APPROVAL_KIND,
          planId: approvedPlan.planId,
          stepsArtifactId: steps.artifactId,
        },
        createdAt: now,
      });
      dbRes.data
        .prepare('UPDATE task_items SET updated_at = ? WHERE task_id = ?')
        .run(now, snapshot.task.taskId);
    });

    txn();
    return artifact
      ? success(artifact)
      : failure('确认实施步骤后缺少 artifact');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`确认实施步骤失败: ${message}`);
  }
}

export function completeDeliveredTask(
  taskId: string,
): Result<TaskPlanningSnapshot> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${taskId}`);
  const openRes = ensureTaskIsOpen(snapshot, '验收完成');
  if (!openRes.success) return openRes;
  if (snapshot.task.lifecycle === TASK_LIFECYCLE.COMPLETED)
    return success(snapshot);
  if (!snapshot.task.prUrl) {
    return failure('只有已交付 Task 可以验收完成');
  }

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const now = iso_timestamp();
    const txn = dbRes.data.transaction(() => {
      insertArtifact({
        taskId: snapshot.task.taskId,
        threadId: snapshot.thread.threadId,
        type: ARTIFACT_TYPE.APPROVAL,
        role: ARTIFACT_ROLE.USER,
        body: '交付已验收，任务完成。',
        metadata: {
          kind: 'delivery_acceptance',
          prUrl: snapshot.task.prUrl,
          prNumber: snapshot.task.prNumber,
        },
        createdAt: now,
      });
      dbRes.data
        .prepare(
          `
            UPDATE task_items
            SET lifecycle = ?, current_workflow_kind = ?, updated_at = ?
            WHERE task_id = ?
          `,
        )
        .run(
          TASK_LIFECYCLE.COMPLETED,
          WORKFLOW_KIND.IMPLEMENTATION,
          now,
          snapshot.task.taskId,
        );
    });

    txn();
    const refreshedSnapshotRes = readTaskPlanningSnapshot(taskId);
    if (!refreshedSnapshotRes.success) return refreshedSnapshotRes;
    return refreshedSnapshotRes.data
      ? success(refreshedSnapshotRes.data)
      : failure(`Task ${taskId} 验收后读取快照失败`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`完成 Task 失败: ${message}`);
  }
}

export function ensureTaskAgentBinding(
  input: EnsureTaskAgentBindingInput,
): Result<TaskAgentBindingRecord> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const now = iso_timestamp();
    const existing = db
      .prepare(
        `
          SELECT * FROM task_agent_bindings
          WHERE thread_id = ? AND agent_id = ? AND provider = ?
        `,
      )
      .get(
        input.threadId,
        input.agentId,
        input.provider,
      ) as TaskAgentBindingRow | null;

    if (!existing) {
      db.prepare(
        `
          INSERT INTO task_agent_bindings (
            thread_id, agent_id, provider, cwd, model, personality_version, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        input.threadId,
        input.agentId,
        input.provider,
        input.cwd || null,
        input.model || null,
        input.personalityVersion || null,
        now,
      );
    } else {
      const shouldResetProviderSession = Boolean(
        input.cwd && existing.cwd && input.cwd !== existing.cwd,
      );
      const fallbackProviderSession = shouldResetProviderSession
        ? undefined
        : readLatestRunProviderSession(
            input.threadId,
            input.agentId,
            input.provider,
          );
      db.prepare(
        `
          UPDATE task_agent_bindings
          SET cwd = COALESCE(?, cwd),
              model = COALESCE(?, model),
              personality_version = COALESCE(?, personality_version),
              provider_session_id = CASE
                WHEN ? THEN NULL
                ELSE COALESCE(provider_session_id, ?)
              END,
              updated_at = ?
          WHERE thread_id = ? AND agent_id = ? AND provider = ?
        `,
      ).run(
        input.cwd || null,
        input.model || null,
        input.personalityVersion || null,
        shouldResetProviderSession ? 1 : 0,
        fallbackProviderSession || null,
        now,
        input.threadId,
        input.agentId,
        input.provider,
      );
    }

    const row = db
      .prepare(
        `
          SELECT * FROM task_agent_bindings
          WHERE thread_id = ? AND agent_id = ? AND provider = ?
        `,
      )
      .get(
        input.threadId,
        input.agentId,
        input.provider,
      ) as TaskAgentBindingRow | null;

    return row
      ? success(mapBinding(row))
      : failure('创建 Agent Binding 后读取失败');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`确保 Agent Binding 失败: ${message}`);
  }
}

function readLatestRunProviderSession(
  threadId: string,
  agentId: string,
  provider: string,
): string | undefined {
  const dbRes = getDb();
  if (!dbRes.success) return undefined;
  const row = dbRes.data
    .prepare(
      `
        SELECT provider_session_id_at_end
        FROM task_agent_runs
        WHERE thread_id = ?
          AND agent_id = ?
          AND provider = ?
          AND provider_session_id_at_end IS NOT NULL
        ORDER BY COALESCE(ended_at, started_at) DESC
        LIMIT 1
      `,
    )
    .get(threadId, agentId, provider) as LatestProviderSessionRow | null;
  return row?.provider_session_id_at_end || undefined;
}

export function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
): Result<void> {
  void taskId;
  void status;
  return failure('旧 task.status 已禁止直接写入，请更新分层状态字段');
}

export function updateTaskWorkflowState(input: {
  taskId: string;
  lifecycle: TaskLifecycle;
  currentWorkflowKind: WorkflowKind;
  threadStatus?: ThreadStatus;
}): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const taskRow = dbRes.data
      .prepare('SELECT * FROM task_items WHERE task_id = ?')
      .get(input.taskId) as TaskItemRow | null;
    if (!taskRow) return failure(`Task 不存在: ${input.taskId}`);
    if (
      normalizeTaskLifecycle(taskRow.lifecycle) === TASK_LIFECYCLE.CANCELLED &&
      input.lifecycle !== TASK_LIFECYCLE.CANCELLED
    ) {
      return failure('Task 已关闭，不能更新工作流状态');
    }
    const now = iso_timestamp();
    const txn = dbRes.data.transaction(() => {
      dbRes.data
        .prepare(
          `
            UPDATE task_items
            SET lifecycle = ?, current_workflow_kind = ?, updated_at = ?
            WHERE task_id = ?
          `,
        )
        .run(input.lifecycle, input.currentWorkflowKind, now, input.taskId);
      if (input.threadStatus) {
        dbRes.data
          .prepare(
            `
              UPDATE task_threads
              SET status = ?, updated_at = ?
              WHERE task_id = ? AND thread_id = (
                SELECT active_thread_id FROM task_items WHERE task_id = ?
              )
            `,
          )
          .run(input.threadStatus, now, input.taskId, input.taskId);
      }
    });
    txn();
    return success(undefined);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`更新 Task 工作流状态失败: ${message}`);
  }
}

export function updateTaskDelivery(
  input: UpdateTaskDeliveryInput,
): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const taskRow = dbRes.data
      .prepare('SELECT * FROM task_items WHERE task_id = ?')
      .get(input.taskId) as TaskItemRow | null;
    if (!taskRow) return failure(`Task 不存在: ${input.taskId}`);
    if (
      normalizeTaskLifecycle(taskRow.lifecycle) === TASK_LIFECYCLE.CANCELLED
    ) {
      return failure('Task 已关闭，不能更新交付信息');
    }
    const result = dbRes.data
      .prepare(
        `
          UPDATE task_items
          SET branch_name = COALESCE(?, branch_name),
              worktree_path = COALESCE(?, worktree_path),
              commit_shas = COALESCE(?, commit_shas),
              pr_url = COALESCE(?, pr_url),
              pr_number = COALESCE(?, pr_number),
              updated_at = ?
          WHERE task_id = ?
        `,
      )
      .run(
        input.branchName || null,
        input.worktreePath || null,
        input.commitShas ? JSON.stringify(input.commitShas) : null,
        input.prUrl || null,
        input.prNumber || null,
        iso_timestamp(),
        input.taskId,
      );
    return result.changes > 0
      ? success(undefined)
      : failure(`Task 不存在: ${input.taskId}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`更新 Task Delivery 信息失败: ${message}`);
  }
}

export function updateTaskRepository(
  input: UpdateTaskRepositoryInput,
): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const result = dbRes.data
      .prepare(
        `
          UPDATE task_items
          SET repo_owner = ?,
              repo_name = ?,
              cwd = COALESCE(?, cwd),
              updated_at = ?
          WHERE task_id = ?
        `,
      )
      .run(
        input.repoOwner,
        input.repoName,
        input.cwd || null,
        iso_timestamp(),
        input.taskId,
      );
    return result.changes > 0
      ? success(undefined)
      : failure(`Task 不存在: ${input.taskId}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`更新 Task 仓库信息失败: ${message}`);
  }
}

function parseTaskPrNumber(prUrl: string): number | undefined {
  const match = prUrl.match(/\/pull\/(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function getTaskAgentStageDefinition(stage: TaskAgentStage) {
  return (
    TASK_AGENT_STAGE_DEFINITIONS.find((definition) => {
      return definition.stage === stage;
    }) || null
  );
}

function failManualStageRun(runId: string, error: string): Result<never> {
  const finishRes = finishTaskAgentRun({
    runId,
    status: AGENT_RUN_STATUS.FAILED,
    error,
  });
  return finishRes.success ? failure(error) : failure(finishRes.error);
}

export function completeTaskAgentStageManually(
  input: CompleteTaskAgentStageManuallyInput,
): Result<TaskPlanningSnapshot> {
  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${input.taskId}`);
  const openRes = ensureTaskIsOpen(snapshot, '人工标记阶段完成');
  if (!openRes.success) return openRes;

  const stageDefinition = getTaskAgentStageDefinition(input.stage);
  if (!stageDefinition) return failure(`未知 Task Agent 阶段: ${input.stage}`);

  const runRes = createTaskAgentRun({
    taskId: input.taskId,
    threadId: snapshot.thread.threadId,
    agentId: stageDefinition.agentId,
    provider: 'manual',
    inputArtifactIds: snapshot.artifacts.map((artifact) => artifact.artifactId),
  });
  if (!runRes.success) return runRes;
  const run = runRes.data;

  let statusRes: Result<void> = success(undefined);
  if (input.stage === TASK_AGENT_STAGE.IMPLEMENTATION) {
    statusRes =
      isTaskDelivering({ task: snapshot.task, thread: snapshot.thread }) ||
      isTaskDelivered(snapshot.task)
        ? success(undefined)
        : updateTaskWorkflowState({
            taskId: input.taskId,
            lifecycle: TASK_LIFECYCLE.READY,
            currentWorkflowKind: WORKFLOW_KIND.IMPLEMENTATION,
            threadStatus: THREAD_STATUS.COMPLETED,
          });
  } else if (input.stage === TASK_AGENT_STAGE.DELIVERY && input.prUrl) {
    const deliveryRes = updateTaskDelivery({
      taskId: input.taskId,
      prUrl: input.prUrl,
      prNumber: input.prNumber || parseTaskPrNumber(input.prUrl),
    });
    statusRes = deliveryRes.success
      ? updateTaskWorkflowState({
          taskId: input.taskId,
          lifecycle: TASK_LIFECYCLE.READY,
          currentWorkflowKind: WORKFLOW_KIND.IMPLEMENTATION,
          threadStatus: THREAD_STATUS.COMPLETED,
        })
      : deliveryRes;
  } else {
    statusRes = success(undefined);
  }
  if (!statusRes.success) {
    return failManualStageRun(run.runId, statusRes.error);
  }

  const body = [
    `${stageDefinition.label}已由人工接管处理。`,
    input.message ? `说明：${input.message.trim()}` : '',
    input.prUrl ? `PR：${input.prUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const artifactRes = recordTaskAgentResult({
    taskId: input.taskId,
    threadId: snapshot.thread.threadId,
    agentId: stageDefinition.agentId,
    provider: 'manual',
    runId: run.runId,
    body,
  });
  if (!artifactRes.success) {
    return failManualStageRun(run.runId, artifactRes.error);
  }

  const finishRes = finishTaskAgentRun({
    runId: run.runId,
    status: AGENT_RUN_STATUS.SUCCEEDED,
    outputArtifactIds: [artifactRes.data.artifactId],
  });
  if (!finishRes.success) return finishRes;

  const refreshedSnapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!refreshedSnapshotRes.success) return refreshedSnapshotRes;
  return refreshedSnapshotRes.data
    ? success(refreshedSnapshotRes.data)
    : failure(`Task ${input.taskId} 人工处理后读取快照失败`);
}

export function readTaskAgentBinding(
  threadId: string,
  agentId: string,
  provider: string,
): Result<TaskAgentBindingRecord | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const row = dbRes.data
      .prepare(
        `
          SELECT * FROM task_agent_bindings
          WHERE thread_id = ? AND agent_id = ? AND provider = ?
        `,
      )
      .get(threadId, agentId, provider) as TaskAgentBindingRow | null;
    return success(row ? mapBinding(row) : null);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`读取 Agent Binding 失败: ${message}`);
  }
}

export function updateTaskAgentProviderSession(
  threadId: string,
  agentId: string,
  provider: string,
  providerSessionId: string,
): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    dbRes.data
      .prepare(
        `
          UPDATE task_agent_bindings
          SET provider_session_id = ?, updated_at = ?
          WHERE thread_id = ? AND agent_id = ? AND provider = ?
        `,
      )
      .run(providerSessionId, iso_timestamp(), threadId, agentId, provider);
    return success(undefined);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`更新 provider session 失败: ${message}`);
  }
}

export function recordTaskAgentProgress(
  input: RecordTaskAgentProgressInput,
): Result<TaskAgentProgressEventRecord> {
  const summary = input.summary.trim();
  if (!summary) return failure('Agent Progress 摘要不能为空');
  const detail = input.detail?.trim();
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const progressId = generateId('prog');
  const createdAt = iso_timestamp();

  try {
    dbRes.data
      .prepare(
        `
          INSERT INTO task_agent_progress_events (
            progress_id, run_id, task_id, thread_id, agent_id, provider,
            phase, summary, detail, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        progressId,
        input.runId,
        input.taskId,
        input.threadId,
        input.agentId,
        input.provider,
        input.phase,
        summary,
        detail || null,
        createdAt,
      );

    return success({
      progressId,
      runId: input.runId,
      taskId: input.taskId,
      threadId: input.threadId,
      agentId: input.agentId,
      provider: input.provider,
      phase: input.phase,
      summary,
      detail: detail || undefined,
      createdAt,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`记录 Agent Progress 失败: ${message}`);
  }
}

export function recordTaskAgentSessionEvent(
  input: RecordTaskAgentSessionEventInput,
): Result<TaskAgentSessionEventRecord> {
  const content = normalizeSessionEventContent(input.content);
  if (!content) return failure('Agent Session 内容不能为空');
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const eventId = generateId('sess');
  const createdAt = iso_timestamp();

  try {
    dbRes.data
      .prepare(
        `
          INSERT INTO task_agent_session_events (
            event_id, run_id, task_id, thread_id, agent_id, provider,
            source, kind, content, metadata, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        eventId,
        input.runId,
        input.taskId,
        input.threadId,
        input.agentId,
        input.provider,
        input.source,
        input.kind,
        content,
        JSON.stringify(input.metadata || {}),
        createdAt,
      );

    return success({
      eventId,
      runId: input.runId,
      taskId: input.taskId,
      threadId: input.threadId,
      agentId: input.agentId,
      provider: input.provider,
      source: input.source,
      kind: input.kind,
      content,
      metadata: input.metadata || {},
      createdAt,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`记录 Agent Session 事件失败: ${message}`);
  }
}

export function createTaskAgentRun(
  input: CreateTaskAgentRunInput,
): Result<TaskAgentRunRecord> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const runId = generateId('run');
  const now = iso_timestamp();
  const inputArtifactIds = input.inputArtifactIds || [];

  try {
    const taskRow = dbRes.data
      .prepare('SELECT * FROM task_items WHERE task_id = ?')
      .get(input.taskId) as TaskItemRow | null;
    if (!taskRow) return failure(`Task 不存在: ${input.taskId}`);
    if (
      normalizeTaskLifecycle(taskRow.lifecycle) === TASK_LIFECYCLE.CANCELLED
    ) {
      return failure('Task 已关闭，不能创建 Agent Run');
    }
    dbRes.data
      .prepare(
        `
          INSERT INTO task_agent_runs (
            run_id, task_id, thread_id, agent_id, provider,
            provider_session_id_at_start, status, input_artifact_ids, started_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        runId,
        input.taskId,
        input.threadId,
        input.agentId,
        input.provider,
        input.providerSessionIdAtStart || null,
        AGENT_RUN_STATUS.RUNNING,
        JSON.stringify(inputArtifactIds),
        now,
      );

    return success({
      runId,
      taskId: input.taskId,
      threadId: input.threadId,
      agentId: input.agentId,
      provider: input.provider,
      providerSessionIdAtStart: input.providerSessionIdAtStart,
      status: AGENT_RUN_STATUS.RUNNING,
      inputArtifactIds,
      outputArtifactIds: [],
      startedAt: now,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`创建 Agent Run 失败: ${message}`);
  }
}

export function finishTaskAgentRun(
  input: FinishTaskAgentRunInput,
): Result<TaskAgentRunRecord> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const endedAt = iso_timestamp();

  try {
    const existingRow = dbRes.data
      .prepare('SELECT * FROM task_agent_runs WHERE run_id = ?')
      .get(input.runId) as TaskAgentRunRow | null;
    if (!existingRow) return failure('结束 Agent Run 后读取失败');
    if (existingRow.status !== AGENT_RUN_STATUS.RUNNING) {
      return success(mapRun(existingRow));
    }
    dbRes.data
      .prepare(
        `
          UPDATE task_agent_runs
          SET status = ?,
              provider_session_id_at_end = ?,
              output_artifact_ids = ?,
              error = ?,
              ended_at = ?
          WHERE run_id = ?
        `,
      )
      .run(
        input.status,
        input.providerSessionIdAtEnd || null,
        JSON.stringify(input.outputArtifactIds || []),
        input.error || null,
        endedAt,
        input.runId,
      );

    const row = dbRes.data
      .prepare('SELECT * FROM task_agent_runs WHERE run_id = ?')
      .get(input.runId) as TaskAgentRunRow | null;
    return row ? success(mapRun(row)) : failure('结束 Agent Run 后读取失败');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`结束 Agent Run 失败: ${message}`);
  }
}

export function recoverInterruptedTaskAgentRuns(
  reason = 'Agent 运行被中断：服务进程在 run 完成前退出或重启。',
): Result<RecoverInterruptedTaskAgentRunsOutput> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const rows = dbRes.data
      .prepare(
        `
          SELECT * FROM task_agent_runs
          WHERE status = ?
          ORDER BY started_at ASC
        `,
      )
      .all(AGENT_RUN_STATUS.RUNNING) as TaskAgentRunRow[];

    const recoveredRuns: TaskAgentRunRecord[] = [];
    const resetTaskIds = new Set<string>();

    for (const row of rows) {
      const finishRes = finishTaskAgentRun({
        runId: String(row.run_id),
        status: AGENT_RUN_STATUS.FAILED,
        providerSessionIdAtEnd:
          typeof row.provider_session_id_at_end === 'string'
            ? row.provider_session_id_at_end
            : undefined,
        error: reason,
      });
      if (!finishRes.success) return finishRes;
      recoveredRuns.push(finishRes.data);

      if (row.agent_id === 'implementer') {
        const resetRes = updateTaskWorkflowState({
          taskId: String(row.task_id),
          lifecycle: TASK_LIFECYCLE.READY,
          currentWorkflowKind: WORKFLOW_KIND.PLANNING,
          threadStatus: THREAD_STATUS.APPROVED,
        });
        if (!resetRes.success) return resetRes;
        resetTaskIds.add(String(row.task_id));
      }

      if (row.agent_id === 'delivery') {
        const resetRes = updateTaskWorkflowState({
          taskId: String(row.task_id),
          lifecycle: TASK_LIFECYCLE.READY,
          currentWorkflowKind: WORKFLOW_KIND.IMPLEMENTATION,
          threadStatus: THREAD_STATUS.COMPLETED,
        });
        if (!resetRes.success) return resetRes;
        resetTaskIds.add(String(row.task_id));
      }
    }

    return success({
      recoveredRuns,
      resetTaskIds: [...resetTaskIds],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`恢复中断的 Agent Run 失败: ${message}`);
  }
}
