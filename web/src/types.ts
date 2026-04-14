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
  status: "running" | "completed" | "error" | "crashed" | "zombie";
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
}

export interface StatusCounts {
  running: number;
  completed: number;
  error: number;
  crashed: number;
  zombie: number;
  total: number;
}
