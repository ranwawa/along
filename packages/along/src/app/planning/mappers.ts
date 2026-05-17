import type {
  TaskAgentBindingRow,
  TaskAgentProgressEventRow,
  TaskAgentRunRow,
  TaskAgentSessionEventRow,
  TaskArtifactRow,
  TaskFeedbackRoundRow,
  TaskItemRow,
  TaskPlanRevisionRow,
  TaskThreadRow,
} from './db-rows';
import {
  normalizeLifecycle,
  normalizeTaskExecutionMode,
  normalizeTaskWorkspaceMode,
  normalizeWorkflowKind,
  parseMetadata,
  parseStringArray,
} from './db-utils';
import { deriveTaskStatusFromWorkflow } from './flow';
import type {
  TaskAgentBindingRecord,
  TaskAgentProgressEventRecord,
  TaskAgentRunRecord,
  TaskAgentSessionEventRecord,
  TaskArtifactRecord,
  TaskFeedbackRoundRecord,
  TaskItemRecord,
  TaskPlanRevisionRecord,
  TaskThreadRecord,
} from './records';
import type { Lifecycle, WorkflowKind } from './types';
import { WORKFLOW_KIND } from './types';

export function mapThread(row: TaskThreadRow): TaskThreadRecord {
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

export function mapArtifact(row: TaskArtifactRow): TaskArtifactRecord {
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

export function mapPlan(row: TaskPlanRevisionRow): TaskPlanRevisionRecord {
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

function mapTaskFields(
  row: TaskItemRow,
  lifecycle: Lifecycle,
  currentWorkflowKind: WorkflowKind,
): TaskItemRecord {
  return {
    taskId: row.task_id,
    title: row.title,
    body: row.body,
    source: row.source,
    status: deriveTaskStatusFromWorkflow({
      lifecycle,
      currentWorkflowKind,
      workflowState:
        currentWorkflowKind === WORKFLOW_KIND.EXEC
          ? 'implementing'
          : 'drafting',
    }),
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
    workspaceMode: normalizeTaskWorkspaceMode(row.workspace_mode),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTask(row: TaskItemRow): TaskItemRecord {
  const lifecycle = normalizeLifecycle(row.lifecycle);
  const currentWorkflowKind = normalizeWorkflowKind(row.current_workflow_kind);
  return mapTaskFields(row, lifecycle, currentWorkflowKind);
}

export function mapRound(row: TaskFeedbackRoundRow): TaskFeedbackRoundRecord {
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

export function mapBinding(row: TaskAgentBindingRow): TaskAgentBindingRecord {
  return {
    threadId: row.thread_id,
    agentId: row.agent_id,
    runtimeId: row.runtime_id,
    runtimeSessionId: row.runtime_session_id || undefined,
    cwd: row.cwd || undefined,
    model: row.model || undefined,
    personalityVersion: row.personality_version || undefined,
    updatedAt: row.updated_at,
  };
}

export function mapRun(row: TaskAgentRunRow): TaskAgentRunRecord {
  return {
    runId: row.run_id,
    taskId: row.task_id,
    threadId: row.thread_id,
    agentId: row.agent_id,
    runtimeId: row.runtime_id,
    runtimeSessionIdAtStart: row.runtime_session_id_at_start || undefined,
    runtimeSessionIdAtEnd: row.runtime_session_id_at_end || undefined,
    status: row.status,
    inputArtifactIds: parseStringArray(row.input_artifact_ids),
    outputArtifactIds: parseStringArray(row.output_artifact_ids),
    error: row.error || undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at || undefined,
  };
}

export function mapProgressEvent(
  row: TaskAgentProgressEventRow,
): TaskAgentProgressEventRecord {
  return {
    progressId: row.progress_id,
    runId: row.run_id,
    taskId: row.task_id,
    threadId: row.thread_id,
    agentId: row.agent_id,
    runtimeId: row.runtime_id,
    phase: row.phase,
    summary: row.summary,
    detail: row.detail || undefined,
    createdAt: row.created_at,
  };
}

export function mapSessionEvent(
  row: TaskAgentSessionEventRow,
): TaskAgentSessionEventRecord {
  return {
    eventId: row.event_id,
    runId: row.run_id,
    taskId: row.task_id,
    threadId: row.thread_id,
    agentId: row.agent_id,
    runtimeId: row.runtime_id,
    source: row.source,
    kind: row.kind,
    content: row.content,
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at,
  };
}
