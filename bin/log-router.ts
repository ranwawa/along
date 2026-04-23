import { AsyncLocalStorage } from "node:async_hooks";
import { consola } from "consola";
import { logWriter } from "./log-writer";
import type { IssueContext, LogCategory, UnifiedLogEntry } from "./log-types";

const issueContextStorage = new AsyncLocalStorage<IssueContext>();

export function withIssueContext<T>(
  owner: string,
  repo: string,
  issueNumber: number,
  fn: () => Promise<T>,
): Promise<T> {
  return issueContextStorage.run({ owner, repo, issueNumber }, fn);
}

export function resolveIssueContext(): IssueContext | null {
  return issueContextStorage.getStore() ?? null;
}

const WEBHOOK_PATTERN = /收到事件[:：]/;
const SERVER_PATTERN = /兜底同步|并发限制|服务器|启动.*端口|关闭|shutdown|started|listening/i;

function classifyCategory(tag: string, message: string): LogCategory {
  if (tag === "webhook-server" || tag === "webhook-router") {
    if (WEBHOOK_PATTERN.test(message)) return "webhook";
    if (SERVER_PATTERN.test(message)) return "server";
  }
  return "lifecycle";
}

function consolaLevelToString(type: string): UnifiedLogEntry["level"] {
  switch (type) {
    case "error":
    case "fatal":
      return "error";
    case "warn":
      return "warn";
    case "success":
      return "success";
    default:
      return "info";
  }
}

export function initLogRouter(): void {
  consola.setReporters([
    {
      log(logObj: any) {
        const tag = logObj.tag || "";
        const message = logObj.args.map(String).join(" ");
        const level = consolaLevelToString(logObj.type || "info");
        const category = classifyCategory(tag, message);

        const entry: UnifiedLogEntry = {
          timestamp: new Date().toISOString(),
          category,
          source: tag || "system",
          level,
          message,
        };

        if (logObj.type === "error" || logObj.type === "fatal") {
          process.stderr.write(`[${tag}] ${message}\n`);
        } else {
          process.stdout.write(`[${tag}] ${message}\n`);
        }

        if (category === "webhook" || category === "server") {
          logWriter.writeGlobal(entry);
          return;
        }

        const ctx = resolveIssueContext();
        if (ctx) {
          logWriter.writeSession(ctx, entry);
        } else {
          logWriter.writeGlobal(entry);
        }
      },
    },
  ]);
}
