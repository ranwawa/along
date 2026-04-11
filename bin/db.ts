/**
 * db.ts - SQLite 数据库模块
 *
 * 替代分散的 status.json 文件，提供 ACID 事务和文件锁保护。
 * 数据库文件: ~/.along/along.db
 *
 * 使用 Bun 内置的 bun:sqlite 模块（API 与 better-sqlite3 兼容）。
 */
import { Database } from "bun:sqlite";
import { config } from "./config";
import path from "path";
import { success, failure } from "./result";
import type { Result } from "./result";

import type { SessionStatus } from "./session-manager";

// ─── 类型 ──────────────────────────────────────────────────

export interface SessionInfo {
  owner: string;
  repo: string;
  issueNumber: number;
}

// ─── JSON 字段列表（读取时 parse，写入时 stringify） ──────

const JSON_FIELDS = new Set([
  "commitShas",
  "stepHistory",
  "ciResults",
  "environment",
  "repo",
]);

// ─── 列名映射（camelCase ↔ snake_case）────────────────────

const CAMEL_TO_SNAKE: Record<string, string> = {
  issueNumber: "issue_number",
  startTime: "start_time",
  endTime: "end_time",
  branchName: "branch_name",
  worktreePath: "worktree_path",
  agentRole: "agent_role",
  agentType: "agent_type",
  agentCommand: "agent_command",
  prUrl: "pr_url",
  prNumber: "pr_number",
  commitShas: "commit_shas",
  lastUpdate: "last_update",
  lastMessage: "last_message",
  currentStep: "current_step",
  stepHistory: "step_history",
  errorMessage: "error_message",
  exitCode: "exit_code",
  crashLog: "crash_log",
  cleanupTime: "cleanup_time",
  cleanupReason: "cleanup_reason",
  retryCount: "retry_count",
  ciResults: "ci_results",
  reviewCommentCount: "review_comment_count",
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

// ─── 单例 DB ───────────────────────────────────────────────

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

function initSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      issue_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      start_time TEXT NOT NULL,
      end_time TEXT,
      branch_name TEXT DEFAULT '',
      worktree_path TEXT DEFAULT '',
      title TEXT DEFAULT '',
      agent_role TEXT,
      agent_type TEXT,
      agent_command TEXT,
      pid INTEGER,
      pr_url TEXT,
      pr_number INTEGER,
      commit_shas TEXT DEFAULT '[]',
      last_update TEXT,
      last_message TEXT,
      current_step TEXT,
      step_history TEXT DEFAULT '[]',
      error_message TEXT,
      exit_code INTEGER,
      crash_log TEXT,
      cleanup_time TEXT,
      cleanup_reason TEXT,
      retry_count INTEGER DEFAULT 0,
      ci_results TEXT,
      review_comment_count INTEGER,
      environment TEXT,
      UNIQUE(owner, repo, issue_number)
    );
  `);

  // 索引可能已存在，逐条创建避免报错
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_pr_number ON sessions(pr_number)"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_branch ON sessions(branch_name)"); } catch {}
}

// ─── 行转换 ───────────────────────────────────────────────

/** 将数据库行（snake_case）转换为 SessionStatus（camelCase），并解析 JSON 字段 */
function rowToSessionStatus(row: any): SessionStatus {
  const result: any = {};
  for (const [snakeKey, value] of Object.entries(row)) {
    if (snakeKey === "id") continue; // 跳过内部 ID

    const camelKey = toCamel(snakeKey);

    // repo 特殊处理：数据库中 owner/repo 是独立列，转换为 { owner, name }
    if (snakeKey === "owner" || snakeKey === "repo") continue;

    if (JSON_FIELDS.has(camelKey) && typeof value === "string") {
      try {
        result[camelKey] = JSON.parse(value);
      } catch {
        result[camelKey] = camelKey === "commitShas" || camelKey === "stepHistory" ? [] : value;
      }
    } else {
      result[camelKey] = value;
    }
  }

  // 构造 repo 对象
  result.repo = { owner: row.owner, name: row.repo };

  return result as SessionStatus;
}

/** 将 Partial<SessionStatus>（camelCase）转换为数据库列（snake_case），并序列化 JSON 字段 */
function statusToColumns(data: Partial<SessionStatus>): Record<string, any> {
  const columns: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === "repo" && value && typeof value === "object") {
      // repo 对象拆分为独立列
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

  return columns;
}

// ─── CRUD 接口 ─────────────────────────────────────────────

/**
 * 读取指定 session 的状态
 */
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

/**
 * 插入或更新 session 状态（UPSERT）
 * 如果记录不存在则插入，存在则合并更新
 */
export function upsertSession(owner: string, repo: string, issueNumber: number, data: Partial<SessionStatus>): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const existing = db.prepare(
      "SELECT id FROM sessions WHERE owner = ? AND repo = ? AND issue_number = ?"
    ).get(owner, repo, issueNumber) as any;

    if (!existing) {
      // INSERT
      const columns = statusToColumns(data);
      columns.owner = columns.owner || owner;
      columns.repo = columns.repo || repo;
      columns.issue_number = issueNumber;

      // 确保必填字段有默认值
      if (!columns.start_time) columns.start_time = new Date().toISOString();
      if (!columns.status) columns.status = "running";

      const keys = Object.keys(columns);
      const placeholders = keys.map(() => "?").join(", ");
      const sql = `INSERT INTO sessions (${keys.join(", ")}) VALUES (${placeholders})`;
      db.prepare(sql).run(...keys.map(k => columns[k]));
    } else {
      // UPDATE：只更新传入的字段
      const columns = statusToColumns(data);
      // 不要覆盖 owner/repo/issue_number
      delete columns.owner;
      delete columns.repo;
      delete columns.issue_number;

      if (Object.keys(columns).length === 0) return success(undefined);

      const setClauses = Object.keys(columns).map(k => `${k} = ?`).join(", ");
      const sql = `UPDATE sessions SET ${setClauses} WHERE owner = ? AND repo = ? AND issue_number = ?`;
      db.prepare(sql).run(...Object.values(columns), owner, repo, issueNumber);
    }
    return success(undefined);
  } catch (e: any) {
    return failure(`保存 Session 失败: ${e.message}`);
  }
}

/**
 * 查询所有 session（可按 owner/repo 过滤）
 */
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
    return success(rows.map(row => ({
      owner: row.owner,
      repo: row.repo,
      issueNumber: row.issue_number,
    })));
  } catch (e: any) {
    return failure(`列出 Session 失败: ${e.message}`);
  }
}

/**
 * 通过 PR 编号查找 session
 */
export function findSessionByPr(
  owner: string,
  repo: string,
  prNumber: number,
): Result<{ issueNumber: number; statusData: SessionStatus } | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    // 先精确匹配 pr_number
    let row = db.prepare(
      "SELECT * FROM sessions WHERE owner = ? AND repo = ? AND pr_number = ?"
    ).get(owner, repo, prNumber) as any;

    // 回退：从 pr_url 匹配
    if (!row) {
      row = db.prepare(
        "SELECT * FROM sessions WHERE owner = ? AND repo = ? AND pr_url LIKE ?"
      ).get(owner, repo, `%/pull/${prNumber}%`) as any;
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

/**
 * 通过分支名查找 session
 */
export function findSessionByBranch(
  branchName: string,
): Result<{ owner: string; repo: string; issueNumber: number; statusData: SessionStatus } | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const row = db.prepare(
      "SELECT * FROM sessions WHERE branch_name = ?"
    ).get(branchName) as any;

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

/**
 * 彻底删除指定 session 的记录
 */
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

/**
 * 关闭数据库连接（用于测试或清理）
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
