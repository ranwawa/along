import fs from 'node:fs';
import path from 'node:path';
import { config } from '../core/config';
import type { LogCategory, UnifiedLogEntry } from '../logging/log-types';

export interface LogReadOptions {
  category?: LogCategory[];
  level?: UnifiedLogEntry['level'][];
  maxLines?: number;
  since?: string;
}

export function readLogFile(
  filePath: string,
  options: LogReadOptions = {},
): UnifiedLogEntry[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  let entries: UnifiedLogEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {}
  }

  if (options.since) {
    const sinceDate = new Date(options.since).getTime();
    entries = entries.filter(
      (e) => new Date(e.timestamp).getTime() >= sinceDate,
    );
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
  const globalPath = path.join(config.USER_ALONG_DIR, 'server.jsonl');
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
    'session.jsonl',
  );
  return readLogFile(sessionPath, options);
}

export function getGlobalLogPath(): string {
  return path.join(config.USER_ALONG_DIR, 'server.jsonl');
}

export function getSessionLogPath(
  owner: string,
  repo: string,
  issueNumber: number,
): string {
  return path.join(
    config.getIssueDir(owner, repo, issueNumber),
    'session.jsonl',
  );
}

export interface ConversationFileInfo {
  filename: string;
  phase: string;
  workflow: string;
  timestamp: string;
  size: number;
}

export function getConversationDir(
  owner: string,
  repo: string,
  issueNumber: number,
): string {
  return path.join(
    config.getIssueDir(owner, repo, issueNumber),
    'conversations',
  );
}

export function listConversationFiles(
  owner: string,
  repo: string,
  issueNumber: number,
): ConversationFileInfo[] {
  const dir = getConversationDir(owner, repo, issueNumber);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .map((filename) => {
      const stat = fs.statSync(path.join(dir, filename));
      const parts = filename.replace('.jsonl', '').split('-');
      // format: YYYY-MM-DDTHH-MM-SS-{phase}-{workflow}
      const tsRaw = parts.slice(0, 6).join('-');
      const rest = parts.slice(6);
      const phase = rest[0] || 'unknown';
      const workflow = rest.slice(1).join('-') || 'unknown';
      return { filename, phase, workflow, timestamp: tsRaw, size: stat.size };
    });
}

export function readConversationFile(
  filePath: string,
  options: { maxLines?: number; since?: string } = {},
): unknown[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  let entries: unknown[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {}
  }

  if (options.maxLines && entries.length > options.maxLines) {
    entries = entries.slice(-options.maxLines);
  }

  return entries;
}
