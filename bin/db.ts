import { Database } from "bun:sqlite";
import path from "path";
import { config } from "./config";
import { success, failure } from "./result";
import type { Result } from "./result";
import type { SessionStatus } from "./session-manager";
import { normalizeLegacySessionState } from "./session-state-machine";

export interface SessionInfo {
  owner: string;
  repo: string;
  issueNumber: number;
}

const JSON_FIELDS = new Set([
  "progress",
  "context",
  "error",
  "ciResults",
  "environment",
  "repo",
]);

const CAMEL_TO_SNAKE: Record<string, string> = {
  issueNumber: "issue_number",
  startTime: "start_time",
  endTime: "end_time",
  phaseStartedAt: "phase_started_at",
  stepStartedAt: "step_started_at",
  worktreePath: "worktree_path",
  agentRole: "agent_role",
  agentType: "agent_type",
  agentCommand: "agent_command",
  lastUpdate: "last_update",
  ciResults: "ci_results",
};

const SNAKE_TO_CAMEL: Record<string, string> = {};
for (const [camel, snake] of Object.entries(CAMEL_TO_SNAKE)) {
  SNAKE_TO_CAMEL[snake] = camel;
}

function toSnake(key: string): string {
  return CAMEL_TO_SNAKE[key] || key;
}

function toCamel(key: string): string {
  return SNAKE_TO_CAMEL[key] || key;
}

let _db: Database | null = null;

export function getDb(): Result<Database> {
  if (_db) return success(_db);

  const dbPath = path.join(config.USER_ALONG_DIR, "along.db");
  config.ensureDataDirs();

  try {
    _db = new Database(dbPath);
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA foreign_keys = ON");
    _db.exec("PRAGMA busy_timeout = 5000");
    initSchema(_db);
    return success(_db);
  } catch (e: any) {
    return failure(`打开数据库失败: ${e.message}`);
  }
}

function tryAddColumn(db: Database, sql: string) {
  try {
    db.exec(sql);
  } catch {
  }
}

function initSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      issue_number INTEGER NOT NULL,
      lifecycle TEXT,
      phase TEXT,
      step TEXT,
      message TEXT,
      progress TEXT,
      context TEXT,
      error TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT,
      phase_started_at TEXT,
      step_started_at TEXT,
      worktree_path TEXT DEFAULT '',
      title TEXT DEFAULT '',
      agent_role TEXT,
      agent_type TEXT,
      agent_command TEXT,
      pid INTEGER,
      last_update TEXT,
      retry_count INTEGER DEFAULT 0,
      ci_results TEXT,
      environment TEXT,
      status TEXT,
      branch_name TEXT DEFAULT '',
      pr_url TEXT,
      pr_number INTEGER,
      commit_shas TEXT DEFAULT '[]',
      last_message TEXT,
      current_step TEXT,
      error_message TEXT,
      exit_code INTEGER,
      crash_log TEXT,
      review_comment_count INTEGER,
      workflow_phase TEXT,
      UNIQUE(owner, repo, issue_number)
    );
  `);

  try { db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_lifecycle ON sessions(lifecycle)"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_pr_number ON sessions(pr_number)"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_branch ON sessions(branch_name)"); } catch {}

  tryAddColumn(db, "ALTER TABLE sessions ADD COLUMN lifecycle TEXT");
  tryAddColumn(db, "ALTER TABLE sessions ADD COLUMN phase TEXT");
  tryAddColumn(db, "ALTER TABLE sessions ADD COLUMN step TEXT");
  tryAddColumn(db, "ALTER TABLE sessions ADD COLUMN message TEXT");
  tryAddColumn(db, "ALTER TABLE sessions ADD COLUMN progress TEXT");
  tryAddColumn(db, "ALTER TABLE sessions ADD COLUMN context TEXT");
  tryAddColumn(db, "ALTER TABLE sessions ADD COLUMN error TEXT");
  tryAddColumn(db, "ALTER TABLE sessions ADD COLUMN phase_started_at TEXT");
  tryAddColumn(db, "ALTER TABLE sessions ADD COLUMN step_started_at TEXT");
}

function rowToSessionStatus(row: any): SessionStatus {
  const result: any = {};
  for (const [snakeKey, value] of Object.entries(row)) {
    if (snakeKey === "id") continue;
    if (snakeKey === "owner" || snakeKey === "repo") continue;

    const camelKey = toCamel(snakeKey);
    if (JSON_FIELDS.has(camelKey) && typeof value === "string") {
      try {
        result[camelKey] = JSON.parse(value);
      } catch {
        result[camelKey] = undefined;
      }
    } else {
      result[camelKey] = value;
    }
  }

  result.repo = { owner: row.owner, name: row.repo };

  if (!result.lifecycle || !result.phase || !result.step) {
    const normalized = normalizeLegacySessionState({
      status: row.status,
      workflowPhase: row.workflow_phase,
      currentStep: row.current_step,
      lastMessage: row.last_message,
      errorMessage: row.error_message,
      crashLog: row.crash_log,
      exitCode: row.exit_code,
      prUrl: row.pr_url,
      prNumber: row.pr_number,
      branchName: row.branch_name,
      reviewCommentCount: row.review_comment_count,
      ciResults: result.ciResults,
      issueNumber: row.issue_number,
      title: row.title,
      repo: result.repo,
    });

    result.lifecycle = normalized.lifecycle;
    result.phase = normalized.phase;
    result.step = normalized.step;
    result.message = result.message || normalized.message;
    result.context = result.context || normalized.context;
    result.error = result.error || normalized.error;
    result.phaseStartedAt = result.phaseStartedAt || row.last_update || row.start_time;
    result.stepStartedAt = result.stepStartedAt || row.last_update || row.start_time;
  }

  if (!result.context) {
    result.context = {
      issueNumber: row.issue_number,
      repo: `${row.owner}/${row.repo}`,
    };
  } else {
    result.context.issueNumber = result.context.issueNumber || row.issue_number;
    result.context.repo = result.context.repo || `${row.owner}/${row.repo}`;
  }

  return result as SessionStatus;
}

function statusToColumns(data: Partial<SessionStatus>): Record<string, any> {
  const columns: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === "repo" && value && typeof value === "object") {
      columns.owner = (value as any).owner;
      columns.repo = (value as any).name;
      continue;
    }

    const snakeKey = toSnake(key);
    if (JSON_FIELDS.has(key) && value !== null && value !== undefined && typeof value !== "string") {
      columns[snakeKey] = JSON.stringify(value);
    } else {
      columns[snakeKey] = value;
    }
  }

  if (data.context?.branchName !== undefined) columns.branch_name = data.context.branchName;
  if (data.context?.prUrl !== undefined) columns.pr_url = data.context.prUrl;
  if (data.context?.prNumber !== undefined) columns.pr_number = data.context.prNumber;
  if (data.context?.reviewCommentCount !== undefined) columns.review_comment_count = data.context.reviewCommentCount;
  if (data.message !== undefined) columns.last_message = data.message;
  if (data.step !== undefined) columns.current_step = data.step;
  if (data.error?.message !== undefined) columns.error_message = data.error.message;
  if (data.error?.details !== undefined) columns.crash_log = data.error.details;
  if (data.error?.code && /^EXIT_\d+$/.test(data.error.code)) {
    columns.exit_code = Number(data.error.code.replace("EXIT_", ""));
  }

  return columns;
}

export function readSession(owner: string, repo: string, issueNumber: number): Result<SessionStatus | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const row = db.prepare(
      "SELECT * FROM sessions WHERE owner = ? AND repo = ? AND issue_number = ?"
    ).get(owner, repo, issueNumber) as any;

    if (!row) return success(null);
    return success(rowToSessionStatus(row));
  } catch (e: any) {
    return failure(`查询 Session 失败: ${e.message}`);
  }
}

export function upsertSession(owner: string, repo: string, issueNumber: number, data: Partial<SessionStatus>): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const existing = db.prepare(
      "SELECT id FROM sessions WHERE owner = ? AND repo = ? AND issue_number = ?"
    ).get(owner, repo, issueNumber) as any;

    if (!existing) {
      const columns = statusToColumns(data);
      columns.owner = columns.owner || owner;
      columns.repo = columns.repo || repo;
      columns.issue_number = issueNumber;
      if (!columns.start_time) columns.start_time = new Date().toISOString();
      if (!columns.lifecycle) columns.lifecycle = "running";
      if (!columns.phase) columns.phase = "planning";
      if (!columns.step) columns.step = "read_issue";
      if (!columns.context) {
        columns.context = JSON.stringify({
          issueNumber,
          repo: `${owner}/${repo}`,
        });
      }
      if (!columns.phase_started_at) columns.phase_started_at = columns.start_time;
      if (!columns.step_started_at) columns.step_started_at = columns.start_time;

      const keys = Object.keys(columns);
      const placeholders = keys.map(() => "?").join(", ");
      const sql = `INSERT INTO sessions (${keys.join(", ")}) VALUES (${placeholders})`;
      db.prepare(sql).run(...keys.map((k) => columns[k]));
    } else {
      const columns = statusToColumns(data);
      delete columns.owner;
      delete columns.repo;
      delete columns.issue_number;

      if (Object.keys(columns).length === 0) return success(undefined);

      const setClauses = Object.keys(columns).map((k) => `${k} = ?`).join(", ");
      const sql = `UPDATE sessions SET ${setClauses} WHERE owner = ? AND repo = ? AND issue_number = ?`;
      db.prepare(sql).run(...Object.values(columns), owner, repo, issueNumber);
    }

    return success(undefined);
  } catch (e: any) {
    return failure(`保存 Session 失败: ${e.message}`);
  }
}

export function findAllSessions(filterOwner?: string, filterRepo?: string): Result<SessionInfo[]> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    let sql = "SELECT owner, repo, issue_number FROM sessions";
    const params: any[] = [];
    const conditions: string[] = [];

    if (filterOwner) {
      conditions.push("owner = ?");
      params.push(filterOwner);
    }
    if (filterRepo) {
      conditions.push("repo = ?");
      params.push(filterRepo);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    const rows = db.prepare(sql).all(...params) as any[];
    return success(rows.map((row) => ({
      owner: row.owner,
      repo: row.repo,
      issueNumber: row.issue_number,
    })));
  } catch (e: any) {
    return failure(`列出 Session 失败: ${e.message}`);
  }
}

export function findSessionByPr(
  owner: string,
  repo: string,
  prNumber: number,
): Result<{ issueNumber: number; statusData: SessionStatus } | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    let row = db.prepare(
      "SELECT * FROM sessions WHERE owner = ? AND repo = ? AND pr_number = ?"
    ).get(owner, repo, prNumber) as any;

    if (!row) {
      row = db.prepare(
        "SELECT * FROM sessions WHERE owner = ? AND repo = ? AND pr_url LIKE ?"
      ).get(owner, repo, `%/pull/${prNumber}%`) as any;
    }

    if (!row) {
      row = db.prepare(
        "SELECT * FROM sessions WHERE owner = ? AND repo = ? AND context LIKE ?"
      ).get(owner, repo, `%"prNumber":${prNumber}%`) as any;
    }

    if (!row) return success(null);

    return success({
      issueNumber: row.issue_number,
      statusData: rowToSessionStatus(row),
    });
  } catch (e: any) {
    return failure(`通过 PR 查找 Session 失败: ${e.message}`);
  }
}

export function findSessionByBranch(
  branchName: string,
): Result<{ owner: string; repo: string; issueNumber: number; statusData: SessionStatus } | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    let row = db.prepare(
      "SELECT * FROM sessions WHERE branch_name = ?"
    ).get(branchName) as any;

    if (!row) {
      row = db.prepare(
        "SELECT * FROM sessions WHERE context LIKE ?"
      ).get(`%"branchName":"${branchName}"%`) as any;
    }

    if (!row) return success(null);

    return success({
      owner: row.owner,
      repo: row.repo,
      issueNumber: row.issue_number,
      statusData: rowToSessionStatus(row),
    });
  } catch (e: any) {
    return failure(`通过分支查找 Session 失败: ${e.message}`);
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
  const db = dbRes.data;

  try {
    const txn = db.transaction(() => {
      const row = db.prepare(
        "SELECT * FROM sessions WHERE owner = ? AND repo = ? AND issue_number = ?"
      ).get(owner, repo, issueNumber) as any;

      const current = row ? rowToSessionStatus(row) : null;
      const updates = modifier(current);

      if (!row) {
        const columns = statusToColumns(updates);
        columns.owner = columns.owner || owner;
        columns.repo = columns.repo || repo;
        columns.issue_number = issueNumber;
        if (!columns.start_time) columns.start_time = new Date().toISOString();
        if (!columns.lifecycle) columns.lifecycle = "running";
        if (!columns.phase) columns.phase = "planning";
        if (!columns.step) columns.step = "read_issue";
        if (!columns.context) {
          columns.context = JSON.stringify({
            issueNumber,
            repo: `${owner}/${repo}`,
          });
        }
        if (!columns.phase_started_at) columns.phase_started_at = columns.start_time;
        if (!columns.step_started_at) columns.step_started_at = columns.start_time;

        const keys = Object.keys(columns);
        const placeholders = keys.map(() => "?").join(", ");
        const sql = `INSERT INTO sessions (${keys.join(", ")}) VALUES (${placeholders})`;
        db.prepare(sql).run(...keys.map((k) => columns[k]));
      } else {
        const columns = statusToColumns(updates);
        delete columns.owner;
        delete columns.repo;
        delete columns.issue_number;

        if (Object.keys(columns).length === 0) return;

        const setClauses = Object.keys(columns).map((k) => `${k} = ?`).join(", ");
        const sql = `UPDATE sessions SET ${setClauses} WHERE owner = ? AND repo = ? AND issue_number = ?`;
        db.prepare(sql).run(...Object.values(columns), owner, repo, issueNumber);
      }
    });

    txn();
    return success(undefined);
  } catch (e: any) {
    return failure(`事务执行失败: ${e.message}`);
  }
}

export function deleteSession(owner: string, repo: string, issueNumber: number): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    db.prepare(
      "DELETE FROM sessions WHERE owner = ? AND repo = ? AND issue_number = ?"
    ).run(owner, repo, issueNumber);
    return success(undefined);
  } catch (e: any) {
    return failure(`删除 Session 记录失败: ${e.message}`);
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
