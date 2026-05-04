import type { Database } from 'bun:sqlite';
import type { SessionStatus } from '../domain/session-manager';
import { getDb } from './db-connection';
import {
  insertSession,
  readSessionRow,
  rowToSessionStatus,
  type SessionRow,
  updateSession,
} from './db-session-codec';
import type { Result } from './result';
import { failure, success } from './result';

export interface SessionInfo {
  owner: string;
  repo: string;
  issueNumber: number;
}

interface SessionInfoRow {
  owner: string;
  repo: string;
  issue_number: number;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function querySessionRow(
  db: Database,
  sql: string,
  ...params: unknown[]
): SessionRow | null {
  return db.prepare(sql).get(...params) as SessionRow | null;
}

export function readSession(
  owner: string,
  repo: string,
  issueNumber: number,
): Result<SessionStatus | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  try {
    const row = readSessionRow(dbRes.data, owner, repo, issueNumber);
    return success(row ? rowToSessionStatus(row) : null);
  } catch (error: unknown) {
    return failure(`查询 Session 失败: ${getErrorMessage(error)}`);
  }
}

export function upsertSession(
  owner: string,
  repo: string,
  issueNumber: number,
  data: Partial<SessionStatus>,
): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  try {
    const existing = readSessionRow(dbRes.data, owner, repo, issueNumber);
    if (existing) updateSession(dbRes.data, owner, repo, issueNumber, data);
    else insertSession(dbRes.data, owner, repo, issueNumber, data);
    return success(undefined);
  } catch (error: unknown) {
    return failure(`保存 Session 失败: ${getErrorMessage(error)}`);
  }
}

export function findAllSessions(
  filterOwner?: string,
  filterRepo?: string,
): Result<SessionInfo[]> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  try {
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (filterOwner) {
      conditions.push('owner = ?');
      params.push(filterOwner);
    }
    if (filterRepo) {
      conditions.push('repo = ?');
      params.push(filterRepo);
    }
    const where =
      conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const rows = dbRes.data
      .prepare(`SELECT owner, repo, issue_number FROM sessions${where}`)
      .all(...params) as Array<SessionInfoRow>;
    return success(rows.map(rowToSessionInfo));
  } catch (error: unknown) {
    return failure(`列出 Session 失败: ${getErrorMessage(error)}`);
  }
}

function rowToSessionInfo(row: SessionInfoRow): SessionInfo {
  return {
    owner: row.owner,
    repo: row.repo,
    issueNumber: row.issue_number,
  };
}

function findPrRow(
  db: Database,
  owner: string,
  repo: string,
  prNumber: number,
) {
  return (
    querySessionRow(
      db,
      'SELECT * FROM sessions WHERE owner = ? AND repo = ? AND pr_number = ?',
      owner,
      repo,
      prNumber,
    ) ||
    querySessionRow(
      db,
      'SELECT * FROM sessions WHERE owner = ? AND repo = ? AND pr_url LIKE ?',
      owner,
      repo,
      `%/pull/${prNumber}%`,
    ) ||
    querySessionRow(
      db,
      'SELECT * FROM sessions WHERE owner = ? AND repo = ? AND context LIKE ?',
      owner,
      repo,
      `%"prNumber":${prNumber}%`,
    )
  );
}

export function findSessionByPr(
  owner: string,
  repo: string,
  prNumber: number,
): Result<{ issueNumber: number; statusData: SessionStatus } | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  try {
    const row = findPrRow(dbRes.data, owner, repo, prNumber);
    if (!row) return success(null);
    return success({
      issueNumber: row.issue_number,
      statusData: rowToSessionStatus(row),
    });
  } catch (error: unknown) {
    return failure(`通过 PR 查找 Session 失败: ${getErrorMessage(error)}`);
  }
}

function findBranchRow(db: Database, branchName: string) {
  return (
    querySessionRow(
      db,
      'SELECT * FROM sessions WHERE branch_name = ?',
      branchName,
    ) ||
    querySessionRow(
      db,
      'SELECT * FROM sessions WHERE context LIKE ?',
      `%"branchName":"${branchName}"%`,
    )
  );
}

export function findSessionByBranch(branchName: string): Result<{
  owner: string;
  repo: string;
  issueNumber: number;
  statusData: SessionStatus;
} | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  try {
    const row = findBranchRow(dbRes.data, branchName);
    if (!row) return success(null);
    return success({
      owner: row.owner,
      repo: row.repo,
      issueNumber: row.issue_number,
      statusData: rowToSessionStatus(row),
    });
  } catch (error: unknown) {
    return failure(`通过分支查找 Session 失败: ${getErrorMessage(error)}`);
  }
}

export function transactSession(
  owner: string,
  repo: string,
  issueNumber: number,
  modifier: (current: SessionStatus | null) => Partial<SessionStatus>,
): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  try {
    const txn = dbRes.data.transaction(() => {
      const row = readSessionRow(dbRes.data, owner, repo, issueNumber);
      const updates = modifier(row ? rowToSessionStatus(row) : null);
      if (row) updateSession(dbRes.data, owner, repo, issueNumber, updates);
      else insertSession(dbRes.data, owner, repo, issueNumber, updates);
    });
    txn();
    return success(undefined);
  } catch (error: unknown) {
    return failure(`事务执行失败: ${getErrorMessage(error)}`);
  }
}

export function deleteSession(
  owner: string,
  repo: string,
  issueNumber: number,
): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  try {
    dbRes.data
      .prepare(
        'DELETE FROM sessions WHERE owner = ? AND repo = ? AND issue_number = ?',
      )
      .run(owner, repo, issueNumber);
    return success(undefined);
  } catch (error: unknown) {
    return failure(`删除 Session 记录失败: ${getErrorMessage(error)}`);
  }
}
