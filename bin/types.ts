import type { SessionLifecycleStatus } from "./session-state-machine";

export interface LogEntry {
  timestamp: Date;
  level: string;
  tag: string;
  message: string;
}

export interface DashboardSession {
  owner: string;
  repo: string;
  issueNumber: number;
  title: string;
  status: SessionLifecycleStatus | "zombie";
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

export interface DashboardProps {
  port: number;
  host: string;
}
