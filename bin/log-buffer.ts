import { consola } from "consola";

export interface LogEntry {
  timestamp: Date;
  level: string;
  tag: string;
  message: string;
}

const MAX_LOG_ENTRIES = 200;
const logEntries: LogEntry[] = [];
let subscriber: (() => void) | null = null;

export function setupLogInterceptor(): void {
  consola.setReporters([
    {
      log(logObj: any) {
        logEntries.push({
          timestamp: logObj.date || new Date(),
          level: logObj.type || "info",
          tag: logObj.tag || "",
          message: logObj.args.map(String).join(" "),
        });
        if (logEntries.length > MAX_LOG_ENTRIES) {
          logEntries.shift();
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
