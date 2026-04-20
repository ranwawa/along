export type DashboardStatus =
  | "phase1_running"
  | "awaiting_approval"
  | "phase2_running"
  | "awaiting_pr"
  | "pr_open"
  | "review_fixing"
  | "ci_fixing"
  | "merged"
  | "error"
  | "crashed"
  | "zombie";

export interface LogEntry {
  timestamp: string;
  level: string;
  tag: string;
  message: string;
}

export interface DashboardSession {
  owner: string;
  repo: string;
  issueNumber: number;
  title: string;
  status: DashboardStatus;
  currentStep: string;
  lastMessage: string;
  startTime: string;
  endTime?: string;
  runtime: string;
  pid?: number;
  prUrl?: string;
  branchName: string;
  agentType?: string;
  retryCount?: number;
  errorMessage?: string;
  crashLog?: string;
  hasWorktree?: boolean;
  workflowPhase?: "phase1" | "phase2";
}

export interface StatusCounts {
  phase1_running: number;
  awaiting_approval: number;
  phase2_running: number;
  awaiting_pr: number;
  pr_open: number;
  review_fixing: number;
  ci_fixing: number;
  merged: number;
  error: number;
  crashed: number;
  zombie: number;
  total: number;
}
