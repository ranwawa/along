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
  TaskPlanStatus,
  ThreadPurpose,
  ThreadStatus,
  WorkflowKind,
} from './types';

export interface TaskThreadRow {
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

export interface TaskArtifactRow {
  artifact_id: string;
  task_id: string;
  thread_id: string;
  type: ArtifactType;
  role: ArtifactRole;
  body: string;
  metadata: string;
  created_at: string;
}

export interface TaskItemRow {
  task_id: string;
  title: string;
  body: string;
  source: string;
  lifecycle?: Lifecycle | null;
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
  workspace_mode?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskPlanRevisionRow {
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

export interface TaskFeedbackRoundRow {
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

export interface TaskAgentBindingRow {
  thread_id: string;
  agent_id: string;
  runtime_id: string;
  runtime_session_id: string | null;
  cwd: string | null;
  model: string | null;
  personality_version: string | null;
  updated_at: string;
}

export interface TaskAgentRunRow {
  run_id: string;
  task_id: string;
  thread_id: string;
  agent_id: string;
  runtime_id: string;
  runtime_session_id_at_start: string | null;
  runtime_session_id_at_end: string | null;
  status: AgentRunStatus;
  input_artifact_ids: string;
  output_artifact_ids: string;
  error: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface TaskAgentProgressEventRow {
  progress_id: string;
  run_id: string;
  task_id: string;
  thread_id: string;
  agent_id: string;
  runtime_id: string;
  phase: TaskAgentProgressPhase;
  summary: string;
  detail: string | null;
  created_at: string;
}

export interface TaskAgentSessionEventRow {
  event_id: string;
  run_id: string;
  task_id: string;
  thread_id: string;
  agent_id: string;
  runtime_id: string;
  source: TaskAgentSessionEventSource;
  kind: TaskAgentSessionEventKind;
  content: string;
  metadata: string;
  created_at: string;
}

export interface TaskIdRow {
  task_id: string;
}
