import { Database } from 'bun:sqlite';
import path from 'node:path';
import type { SessionStatus } from '../domain/session-manager';
import { config } from './config';
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

const JSON_FIELDS = new Set([
  'progress',
  'context',
  'error',
  'ciResults',
  'environment',
  'repo',
]);

const CAMEL_TO_SNAKE: Record<string, string> = {
  issueNumber: 'issue_number',
  startTime: 'start_time',
  endTime: 'end_time',
  phaseStartedAt: 'phase_started_at',
  stepStartedAt: 'step_started_at',
  worktreePath: 'worktree_path',
  agentRole: 'agent_role',
  agentType: 'agent_type',
  agentCommand: 'agent_command',
  lastUpdate: 'last_update',
  ciResults: 'ci_results',
  claudeSessionId: 'claude_session_id',
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

  const dbPath = path.join(config.USER_ALONG_DIR, 'along.db');
  config.ensureDataDirs();

  try {
    _db = new Database(dbPath);
    _db.exec('PRAGMA journal_mode = WAL');
    _db.exec('PRAGMA foreign_keys = ON');
    _db.exec('PRAGMA busy_timeout = 5000');
    initSchema(_db);
    return success(_db);
  } catch (error: unknown) {
    return failure(`打开数据库失败: ${getErrorMessage(error)}`);
  }
}

function tryAddColumn(db: Database, sql: string) {
  try {
    db.exec(sql);
  } catch {}
}

interface SessionRow extends Record<string, unknown> {
  id?: number;
  owner: string;
  repo: string;
  issue_number: number;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
      claude_session_id TEXT,
      UNIQUE(owner, repo, issue_number)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS planning_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      issue_number INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      is_closed INTEGER NOT NULL DEFAULT 0,
      current_plan_id TEXT,
      open_round_id TEXT,
      approved_plan_id TEXT,
      last_processed_comment_id INTEGER,
      updated_at TEXT NOT NULL,
      UNIQUE(owner, repo, issue_number)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS plan_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      issue_number INTEGER NOT NULL,
      plan_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      based_on_plan_id TEXT,
      status TEXT NOT NULL,
      comment_id INTEGER NOT NULL,
      summary TEXT,
      scope TEXT,
      changes TEXT,
      risks TEXT,
      validation TEXT,
      decision_log TEXT,
      changes_since_last_version TEXT,
      body TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(plan_id),
      UNIQUE(owner, repo, issue_number, version)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS discussion_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      issue_number INTEGER NOT NULL,
      round_id TEXT NOT NULL,
      based_on_plan_id TEXT,
      snapshot_comment_ids TEXT NOT NULL DEFAULT '[]',
      snapshot_last_seen_comment_id INTEGER,
      status TEXT NOT NULL,
      resolution TEXT,
      produced_plan_id TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      UNIQUE(round_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS comment_mirror (
      comment_id INTEGER PRIMARY KEY,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      issue_number INTEGER NOT NULL,
      author_login TEXT NOT NULL,
      author_type TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      mirrored_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_items (
      task_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      active_thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_threads (
      thread_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      status TEXT NOT NULL,
      current_plan_id TEXT,
      open_round_id TEXT,
      approved_plan_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES task_items(task_id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_artifacts (
      artifact_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      type TEXT NOT NULL,
      role TEXT NOT NULL,
      body TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES task_items(task_id) ON DELETE CASCADE,
      FOREIGN KEY(thread_id) REFERENCES task_threads(thread_id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_plan_revisions (
      plan_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      based_on_plan_id TEXT,
      status TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(thread_id, version),
      FOREIGN KEY(task_id) REFERENCES task_items(task_id) ON DELETE CASCADE,
      FOREIGN KEY(thread_id) REFERENCES task_threads(thread_id) ON DELETE CASCADE,
      FOREIGN KEY(artifact_id) REFERENCES task_artifacts(artifact_id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_feedback_rounds (
      round_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      based_on_plan_id TEXT NOT NULL,
      feedback_artifact_ids TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      resolution TEXT,
      produced_plan_id TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY(task_id) REFERENCES task_items(task_id) ON DELETE CASCADE,
      FOREIGN KEY(thread_id) REFERENCES task_threads(thread_id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_agent_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_session_id TEXT,
      cwd TEXT,
      model TEXT,
      personality_version TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(thread_id, agent_id, provider),
      FOREIGN KEY(thread_id) REFERENCES task_threads(thread_id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_agent_runs (
      run_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_session_id_at_start TEXT,
      provider_session_id_at_end TEXT,
      status TEXT NOT NULL,
      input_artifact_ids TEXT NOT NULL DEFAULT '[]',
      output_artifact_ids TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      FOREIGN KEY(task_id) REFERENCES task_items(task_id) ON DELETE CASCADE,
      FOREIGN KEY(thread_id) REFERENCES task_threads(thread_id) ON DELETE CASCADE
    );
  `);

  try {
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_sessions_lifecycle ON sessions(lifecycle)',
    );
  } catch {}
  try {
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_sessions_pr_number ON sessions(pr_number)',
    );
  } catch {}
  try {
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_sessions_branch ON sessions(branch_name)',
    );
  } catch {}
  try {
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_plan_revisions_issue ON plan_revisions(owner, repo, issue_number, version)',
    );
  } catch {}
  try {
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_discussion_rounds_issue ON discussion_rounds(owner, repo, issue_number, created_at)',
    );
  } catch {}
  try {
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_comment_mirror_issue ON comment_mirror(owner, repo, issue_number, comment_id)',
    );
  } catch {}
  try {
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_revisions_active_issue ON plan_revisions(owner, repo, issue_number) WHERE status = 'active'",
    );
  } catch {}
  try {
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_discussion_rounds_open_issue ON discussion_rounds(owner, repo, issue_number) WHERE status IN ('open','processing','stale_partial')",
    );
  } catch {}
  try {
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_task_items_status ON task_items(status, updated_at)',
    );
  } catch {}
  try {
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_task_threads_task ON task_threads(task_id, purpose, status)',
    );
  } catch {}
  try {
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_task_artifacts_thread ON task_artifacts(thread_id, created_at)',
    );
  } catch {}
  try {
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_task_plan_revisions_active_thread ON task_plan_revisions(thread_id) WHERE status = 'active'",
    );
  } catch {}
  try {
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_task_feedback_rounds_open_thread ON task_feedback_rounds(thread_id) WHERE status IN ('open','processing','stale_partial')",
    );
  } catch {}
  try {
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_task_agent_runs_active ON task_agent_runs(thread_id, agent_id, provider) WHERE status = 'running'",
    );
  } catch {}

  tryAddColumn(db, 'ALTER TABLE sessions ADD COLUMN lifecycle TEXT');
  tryAddColumn(db, 'ALTER TABLE sessions ADD COLUMN phase TEXT');
  tryAddColumn(db, 'ALTER TABLE sessions ADD COLUMN step TEXT');
  tryAddColumn(db, 'ALTER TABLE sessions ADD COLUMN message TEXT');
  tryAddColumn(db, 'ALTER TABLE sessions ADD COLUMN progress TEXT');
  tryAddColumn(db, 'ALTER TABLE sessions ADD COLUMN context TEXT');
  tryAddColumn(db, 'ALTER TABLE sessions ADD COLUMN error TEXT');
  tryAddColumn(db, 'ALTER TABLE sessions ADD COLUMN phase_started_at TEXT');
  tryAddColumn(db, 'ALTER TABLE sessions ADD COLUMN step_started_at TEXT');
  tryAddColumn(db, 'ALTER TABLE sessions ADD COLUMN claude_session_id TEXT');
}

function rowToSessionStatus(row: SessionRow): SessionStatus {
  const result: Partial<SessionStatus> = {};
  for (const [snakeKey, value] of Object.entries(row)) {
    if (snakeKey === 'id') continue;
    if (snakeKey === 'owner' || snakeKey === 'repo') continue;

    const camelKey = toCamel(snakeKey);
    if (JSON_FIELDS.has(camelKey) && typeof value === 'string') {
      try {
        result[camelKey] = JSON.parse(value);
      } catch {
        result[camelKey] = undefined;
      }
    } else {
      result[camelKey as keyof SessionStatus] = value as never;
    }
  }

  result.repo = { owner: row.owner, name: row.repo };

  if (!result.lifecycle || !result.phase || !result.step) {
    result.lifecycle = result.lifecycle || 'running';
    result.phase = result.phase || 'planning';
    result.step = result.step || 'read_issue';
    result.message = result.message || undefined;
    result.phaseStartedAt =
      result.phaseStartedAt || row.last_update || row.start_time;
    result.stepStartedAt =
      result.stepStartedAt || row.last_update || row.start_time;
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

function statusToColumns(
  data: Partial<SessionStatus>,
): Record<string, unknown> {
  const columns: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === 'repo' && value && typeof value === 'object') {
      const repoValue = value as { owner?: unknown; name?: unknown };
      if (typeof repoValue.owner === 'string') columns.owner = repoValue.owner;
      if (typeof repoValue.name === 'string') columns.repo = repoValue.name;
      continue;
    }

    const snakeKey = toSnake(key);
    if (
      JSON_FIELDS.has(key) &&
      value !== null &&
      value !== undefined &&
      typeof value !== 'string'
    ) {
      columns[snakeKey] = JSON.stringify(value);
    } else {
      columns[snakeKey] = value;
    }
  }

  if (data.context?.branchName !== undefined)
    columns.branch_name = data.context.branchName;
  if (data.context?.prUrl !== undefined) columns.pr_url = data.context.prUrl;
  if (data.context?.prNumber !== undefined)
    columns.pr_number = data.context.prNumber;
  if (data.context?.reviewCommentCount !== undefined)
    columns.review_comment_count = data.context.reviewCommentCount;
  if (data.message !== undefined) columns.last_message = data.message;
  if (data.step !== undefined) columns.current_step = data.step;
  if (data.error?.message !== undefined)
    columns.error_message = data.error.message;
  if (data.error?.details !== undefined) columns.crash_log = data.error.details;
  if (data.error?.code && /^EXIT_\d+$/.test(data.error.code)) {
    columns.exit_code = Number(data.error.code.replace('EXIT_', ''));
  }

  return columns;
}

export function readSession(
  owner: string,
  repo: string,
  issueNumber: number,
): Result<SessionStatus | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const row = db
      .prepare(
        'SELECT * FROM sessions WHERE owner = ? AND repo = ? AND issue_number = ?',
      )
      .get(owner, repo, issueNumber) as SessionRow | null;

    if (!row) return success(null);
    return success(rowToSessionStatus(row));
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
  const db = dbRes.data;

  try {
    const existing = db
      .prepare(
        'SELECT id FROM sessions WHERE owner = ? AND repo = ? AND issue_number = ?',
      )
      .get(owner, repo, issueNumber) as { id: number } | null;

    if (!existing) {
      const columns = statusToColumns(data);
      columns.owner = columns.owner || owner;
      columns.repo = columns.repo || repo;
      columns.issue_number = issueNumber;
      if (!columns.start_time) columns.start_time = new Date().toISOString();
      if (!columns.lifecycle) columns.lifecycle = 'running';
      if (!columns.phase) columns.phase = 'planning';
      if (!columns.step) columns.step = 'read_issue';
      if (!columns.context) {
        columns.context = JSON.stringify({
          issueNumber,
          repo: `${owner}/${repo}`,
        });
      }
      if (!columns.phase_started_at)
        columns.phase_started_at = columns.start_time;
      if (!columns.step_started_at)
        columns.step_started_at = columns.start_time;

      const keys = Object.keys(columns);
      const placeholders = keys.map(() => '?').join(', ');
      const sql = `INSERT INTO sessions (${keys.join(', ')}) VALUES (${placeholders})`;
      db.prepare(sql).run(...keys.map((k) => columns[k]));
    } else {
      const columns = statusToColumns(data);
      delete columns.owner;
      delete columns.repo;
      delete columns.issue_number;

      if (Object.keys(columns).length === 0) return success(undefined);

      const setClauses = Object.keys(columns)
        .map((k) => `${k} = ?`)
        .join(', ');
      const sql = `UPDATE sessions SET ${setClauses} WHERE owner = ? AND repo = ? AND issue_number = ?`;
      db.prepare(sql).run(...Object.values(columns), owner, repo, issueNumber);
    }

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
  const db = dbRes.data;

  try {
    let sql = 'SELECT owner, repo, issue_number FROM sessions';
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

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    const rows = db.prepare(sql).all(...params) as Array<SessionInfoRow>;
    return success(
      rows.map((row) => ({
        owner: row.owner,
        repo: row.repo,
        issueNumber: row.issue_number,
      })),
    );
  } catch (error: unknown) {
    return failure(`列出 Session 失败: ${getErrorMessage(error)}`);
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
    let row = db
      .prepare(
        'SELECT * FROM sessions WHERE owner = ? AND repo = ? AND pr_number = ?',
      )
      .get(owner, repo, prNumber) as SessionRow | null;

    if (!row) {
      row = db
        .prepare(
          'SELECT * FROM sessions WHERE owner = ? AND repo = ? AND pr_url LIKE ?',
        )
        .get(owner, repo, `%/pull/${prNumber}%`) as SessionRow | null;
    }

    if (!row) {
      row = db
        .prepare(
          'SELECT * FROM sessions WHERE owner = ? AND repo = ? AND context LIKE ?',
        )
        .get(owner, repo, `%"prNumber":${prNumber}%`) as SessionRow | null;
    }

    if (!row) return success(null);

    return success({
      issueNumber: row.issue_number,
      statusData: rowToSessionStatus(row),
    });
  } catch (error: unknown) {
    return failure(`通过 PR 查找 Session 失败: ${getErrorMessage(error)}`);
  }
}

export function findSessionByBranch(branchName: string): Result<{
  owner: string;
  repo: string;
  issueNumber: number;
  statusData: SessionStatus;
} | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    let row = db
      .prepare('SELECT * FROM sessions WHERE branch_name = ?')
      .get(branchName) as SessionRow | null;

    if (!row) {
      row = db
        .prepare('SELECT * FROM sessions WHERE context LIKE ?')
        .get(`%"branchName":"${branchName}"%`) as SessionRow | null;
    }

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
  const db = dbRes.data;

  try {
    const txn = db.transaction(() => {
      const row = db
        .prepare(
          'SELECT * FROM sessions WHERE owner = ? AND repo = ? AND issue_number = ?',
        )
        .get(owner, repo, issueNumber) as SessionRow | null;

      const current = row ? rowToSessionStatus(row) : null;
      const updates = modifier(current);

      if (!row) {
        const columns = statusToColumns(updates);
        columns.owner = columns.owner || owner;
        columns.repo = columns.repo || repo;
        columns.issue_number = issueNumber;
        if (!columns.start_time) columns.start_time = new Date().toISOString();
        if (!columns.lifecycle) columns.lifecycle = 'running';
        if (!columns.phase) columns.phase = 'planning';
        if (!columns.step) columns.step = 'read_issue';
        if (!columns.context) {
          columns.context = JSON.stringify({
            issueNumber,
            repo: `${owner}/${repo}`,
          });
        }
        if (!columns.phase_started_at)
          columns.phase_started_at = columns.start_time;
        if (!columns.step_started_at)
          columns.step_started_at = columns.start_time;

        const keys = Object.keys(columns);
        const placeholders = keys.map(() => '?').join(', ');
        const sql = `INSERT INTO sessions (${keys.join(', ')}) VALUES (${placeholders})`;
        db.prepare(sql).run(...keys.map((k) => columns[k]));
      } else {
        const columns = statusToColumns(updates);
        delete columns.owner;
        delete columns.repo;
        delete columns.issue_number;

        if (Object.keys(columns).length === 0) return;

        const setClauses = Object.keys(columns)
          .map((k) => `${k} = ?`)
          .join(', ');
        const sql = `UPDATE sessions SET ${setClauses} WHERE owner = ? AND repo = ? AND issue_number = ?`;
        db.prepare(sql).run(
          ...Object.values(columns),
          owner,
          repo,
          issueNumber,
        );
      }
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
  const db = dbRes.data;

  try {
    db.prepare(
      'DELETE FROM sessions WHERE owner = ? AND repo = ? AND issue_number = ?',
    ).run(owner, repo, issueNumber);
    return success(undefined);
  } catch (error: unknown) {
    return failure(`删除 Session 记录失败: ${getErrorMessage(error)}`);
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
