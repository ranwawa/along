import { consola } from "consola";

export interface LogEntry {
  timestamp: Date;
  level: string;
  tag: string;
  message: string;
}

const MAX_LOG_ENTRIES = 500;
let logEntries: LogEntry[] = [];
let subscriber: (() => void) | null = null;

export function setCurrentIssueContext(owner: string, repo: string, issueNumber: number): void {
  void owner;
  void repo;
  void issueNumber;
}

export function clearCurrentIssueContext(): void {
}

export function setupLogInterceptor(): void {
  consola.setReporters([
    {
      log(logObj: any) {
        const entry: LogEntry = {
          timestamp: logObj.date || new Date(),
          level: logObj.type || "info",
          tag: logObj.tag || "",
          message: logObj.args.map(String).join(" "),
        };
        logEntries.push(entry);
        if (logEntries.length > MAX_LOG_ENTRIES) {
          logEntries.shift();
        }

        // 同时打印到终端
        if (logObj.type === "error" || logObj.type === "fatal") {
           process.stderr.write(`[${entry.tag}] ${entry.message}\n`);
        } else {
           process.stdout.write(`[${entry.tag}] ${entry.message}\n`);
        }
        
        subscriber?.();
      },
    },
  ]);
}

export function getLogEntries(): LogEntry[] {
  return logEntries;
}

export function subscribeToLogs(cb: () => void): () => void {
  subscriber = cb;
  return () => {
    if (subscriber === cb) subscriber = null;
  };
}
