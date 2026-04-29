export type DashboardLifecycle =
  | 'running'
  | 'waiting_human'
  | 'waiting_external'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'zombie';

export type DashboardPhase =
  | 'planning'
  | 'implementation'
  | 'delivery'
  | 'stabilization'
  | 'done';

export type DashboardStep =
  | 'read_issue'
  | 'understand_scope'
  | 'prepare_workspace'
  | 'prepare_branch'
  | 'analyze_codebase'
  | 'identify_change_set'
  | 'draft_plan'
  | 'publish_plan'
  | 'await_approval'
  | 'sync_approved_plan'
  | 'edit_code'
  | 'update_tests'
  | 'run_targeted_validation'
  | 'record_progress'
  | 'prepare_commit'
  | 'push_commits'
  | 'draft_pr'
  | 'open_pr'
  | 'triage_review_feedback'
  | 'address_review_feedback'
  | 'triage_ci_failures'
  | 'fix_ci'
  | 'await_merge'
  | 'archive_result';

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

export type LogCategory =
  | 'lifecycle'
  | 'conversation'
  | 'diagnostic'
  | 'webhook'
  | 'server';

export interface UnifiedLogEntry {
  timestamp: string;
  category: LogCategory;
  source: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  payload?: Record<string, unknown>;
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

export interface ConversationFileInfo {
  filename: string;
  phase: string;
  workflow: string;
  timestamp: string;
  size: number;
}

export interface ConversationMessage {
  type: string;
  subtype?: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: unknown;
    }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  session_id?: string;
  num_turns?: number;
  total_cost_usd?: number;
  tool_name?: string;
  tool_input?: string;
  [key: string]: unknown;
}
