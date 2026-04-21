import type { SessionContext, SessionLifecycle, SessionPhase, SessionProgress, SessionStep } from "./session-state-machine";

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
  lifecycle: SessionLifecycle | "zombie";
  phase: SessionPhase;
  step: SessionStep;
  message?: string;
  progress?: SessionProgress;
  context?: SessionContext;
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

export interface DashboardProps {
  port: number;
  host: string;
}
