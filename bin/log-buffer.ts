import { consola } from "consola";
import fs from "fs";
import path from "path";
import os from "os";

export interface LogEntry {
  timestamp: Date;
  level: string;
  tag: string;
  message: string;
  issueKey?: string;
}

const MAX_LOG_ENTRIES = 500;
let logEntries: LogEntry[] = [];
let subscriber: (() => void) | null = null;
const logFilePath = path.join(os.homedir(), ".along", "webhook.log");

let _currentIssueKey: string | undefined;

export function setCurrentIssueContext(owner: string, repo: string, issueNumber: number): void {
  _currentIssueKey = `${owner}/${repo}#${issueNumber}`;
}

export function clearCurrentIssueContext(): void {
  _currentIssueKey = undefined;
}

export function getIssueLogs(issueKey: string): LogEntry[] {
  return logEntries.filter(e => e.issueKey === issueKey);
}

function loadLogs() {
  try {
    if (fs.existsSync(logFilePath)) {
      const content = fs.readFileSync(logFilePath, "utf8");
      const lines = content.split("\n").filter(Boolean);
      logEntries = lines.slice(-MAX_LOG_ENTRIES).map(line => {
        try {
          const parsed = JSON.parse(line);
          return { ...parsed, timestamp: new Date(parsed.timestamp) };
        } catch {
          return null;
        }
      }).filter(Boolean) as LogEntry[];
    }
  } catch (e) {
    // Ignore loading errors
  }
}

export function setupLogInterceptor(): void {
  // 确保目录存在
  const logDir = path.dirname(logFilePath);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  loadLogs();

  consola.setReporters([
    {
      log(logObj: any) {
        const entry: LogEntry = {
          timestamp: logObj.date || new Date(),
          level: logObj.type || "info",
          tag: logObj.tag || "",
          message: logObj.args.map(String).join(" "),
          issueKey: _currentIssueKey,
        };
        logEntries.push(entry);
        if (logEntries.length > MAX_LOG_ENTRIES) {
          logEntries.shift();
        }

        // 追加到日志文件
        try {
          fs.appendFileSync(logFilePath, JSON.stringify(entry) + "\n");
        } catch {}

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
