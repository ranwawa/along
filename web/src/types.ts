export type DashboardLifecycle =
  | "running"
  | "waiting_human"
  | "waiting_external"
  | "completed"
  | "failed"
  | "interrupted"
  | "zombie";

export type DashboardPhase =
  | "planning"
  | "implementation"
  | "delivery"
  | "stabilization"
  | "done";

export type DashboardStep =
  | "read_issue"
  | "understand_scope"
  | "prepare_workspace"
  | "prepare_branch"
  | "analyze_codebase"
  | "identify_change_set"
  | "draft_plan"
  | "publish_plan"
  | "await_approval"
  | "sync_approved_plan"
  | "edit_code"
  | "update_tests"
  | "run_targeted_validation"
  | "record_progress"
  | "prepare_commit"
  | "push_commits"
  | "draft_pr"
  | "open_pr"
  | "triage_review_feedback"
  | "address_review_feedback"
  | "triage_ci_failures"
  | "fix_ci"
  | "await_merge"
  | "archive_result";

export interface LogEntry {
  timestamp: string;
  level: string;
  tag: string;
  message: string;
}

export interface SessionLogEntry {
  source: "system" | "agent" | "merged";
  raw: string;
  timestamp?: string;
  level?: string;
  message: string;
  tag?: string;
}

export interface SessionDiagnostic {
  category: string;
  summary: string;
  failedAt?: string;
  phase?: DashboardPhase;
  exitCode?: number;
  command?: string;
  errorMessage?: string;
  hints: string[];
  lastSystemLines: string[];
  lastAgentLines: string[];
}

export interface DashboardSession {
  owner: string;
  repo: string;
  issueNumber: number;
  title: string;
  lifecycle: DashboardLifecycle;
  phase?: DashboardPhase;
  step?: DashboardStep;
  message?: string;
  progress?: {
    current?: number;
    total?: number;
    unit?: string;
    label?: string;
  };
  context?: {
    issueNumber: number;
    title?: string;
    repo?: string;
    branchName?: string;
    commitShas?: string[];
    prNumber?: number;
    prUrl?: string;
    reviewCommentCount?: number;
    failedCiCount?: number;
    changedFiles?: string[];
  };
  startTime: string;
  endTime?: string;
  runtime: string;
  pid?: number;
  agentType?: string;
  retryCount?: number;
  error?: {
    code?: string;
    message: string;
    retryable?: boolean;
    details?: string;
  };
  hasWorktree?: boolean;
}

export interface ConversationMessage {
  type: "user" | "assistant" | "tool_use" | "tool_result";
  content?: string;
  toolName?: string;
  toolInput?: string;
  isError?: boolean;
  timestamp?: string;
}

export interface StatusCounts {
  running: number;
  waiting_human: number;
  waiting_external: number;
  completed: number;
  failed: number;
  interrupted: number;
  zombie: number;
  total: number;
}
