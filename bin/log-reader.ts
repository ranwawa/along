import fs from "fs";
import path from "path";
import { config } from "./config";
import type { LogCategory, UnifiedLogEntry } from "./log-types";

export interface LogReadOptions {
  category?: LogCategory[];
  level?: UnifiedLogEntry["level"][];
  maxLines?: number;
  since?: string;
}

export function readLogFile(
  filePath: string,
  options: LogReadOptions = {},
): UnifiedLogEntry[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  let entries: UnifiedLogEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {}
  }

  if (options.since) {
    const sinceDate = new Date(options.since).getTime();
    entries = entries.filter((e) => new Date(e.timestamp).getTime() >= sinceDate);
  }

  if (options.category?.length) {
    const cats = new Set(options.category);
    entries = entries.filter((e) => cats.has(e.category));
  }

  if (options.level?.length) {
    const lvls = new Set(options.level);
    entries = entries.filter((e) => lvls.has(e.level));
  }

  if (options.maxLines && entries.length > options.maxLines) {
    entries = entries.slice(-options.maxLines);
  }

  return entries;
}

export function readGlobalLog(options: LogReadOptions = {}): UnifiedLogEntry[] {
  const globalPath = path.join(config.USER_ALONG_DIR, "server.jsonl");
  return readLogFile(globalPath, options);
}

export function readSessionLog(
  owner: string,
  repo: string,
  issueNumber: number,
  options: LogReadOptions = {},
): UnifiedLogEntry[] {
  const sessionPath = path.join(
    config.getIssueDir(owner, repo, issueNumber),
    "session.jsonl",
  );
  return readLogFile(sessionPath, options);
}

export function getGlobalLogPath(): string {
  return path.join(config.USER_ALONG_DIR, "server.jsonl");
}

export function getSessionLogPath(
  owner: string,
  repo: string,
  issueNumber: number,
): string {
  return path.join(
    config.getIssueDir(owner, repo, issueNumber),
    "session.jsonl",
  );
}
