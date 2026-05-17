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

export interface IssueContext {
  owner: string;
  repo: string;
  issueNumber: number;
}

export interface LifecyclePayload {
  event: string;
  phase?: string;
  step?: string;
  details?: Record<string, unknown>;
}

export interface DiagnosticPayload {
  errorCategory?: string;
  exitCode?: number;
  command?: string;
  hints?: string[];
}

export interface WebhookPayload {
  deliveryId: string;
  event: string;
  repo: string;
  action?: string;
}

export interface ServerPayload {
  event: string;
  details?: Record<string, unknown>;
}
