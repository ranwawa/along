export interface LogEntry {
  timestamp: Date;
  level: string;
  tag: string;
  message: string;
}

export interface DashboardProps {
  port: number;
  host: string;
}
