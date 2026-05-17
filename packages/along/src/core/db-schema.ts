import type { Database } from 'bun:sqlite';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS task_items (
    task_id TEXT PRIMARY KEY,
    title TEXT NOT NULL, body TEXT NOT NULL, source TEXT NOT NULL,
    active_thread_id TEXT, repo_owner TEXT, repo_name TEXT,
    lifecycle TEXT NOT NULL DEFAULT 'active',
    current_workflow_kind TEXT NOT NULL DEFAULT 'plan',
    cwd TEXT, worktree_path TEXT, branch_name TEXT, commit_shas TEXT DEFAULT '[]',
    pr_url TEXT, pr_number INTEGER, seq INTEGER, type TEXT,
    execution_mode TEXT NOT NULL DEFAULT 'manual',
    workspace_mode TEXT NOT NULL DEFAULT 'worktree',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS task_threads (
    thread_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL,
    current_plan_id TEXT, open_round_id TEXT, approved_plan_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY(task_id) REFERENCES task_items(task_id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS task_artifacts (
    artifact_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL, thread_id TEXT NOT NULL, type TEXT NOT NULL,
    role TEXT NOT NULL, body TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY(task_id) REFERENCES task_items(task_id) ON DELETE CASCADE,
    FOREIGN KEY(thread_id) REFERENCES task_threads(thread_id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS task_attachments (
    attachment_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL, thread_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
    kind TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, relative_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(task_id) REFERENCES task_items(task_id) ON DELETE CASCADE,
    FOREIGN KEY(thread_id) REFERENCES task_threads(thread_id) ON DELETE CASCADE,
    FOREIGN KEY(artifact_id) REFERENCES task_artifacts(artifact_id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS task_plan_revisions (
    plan_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL, thread_id TEXT NOT NULL, version INTEGER NOT NULL,
    based_on_plan_id TEXT, status TEXT NOT NULL, artifact_id TEXT NOT NULL,
    body TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(thread_id, version),
    FOREIGN KEY(task_id) REFERENCES task_items(task_id) ON DELETE CASCADE,
    FOREIGN KEY(thread_id) REFERENCES task_threads(thread_id) ON DELETE CASCADE,
    FOREIGN KEY(artifact_id) REFERENCES task_artifacts(artifact_id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS task_feedback_rounds (
    round_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL, thread_id TEXT NOT NULL, based_on_plan_id TEXT NOT NULL,
    feedback_artifact_ids TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
    resolution TEXT, produced_plan_id TEXT, created_at TEXT NOT NULL,
    resolved_at TEXT,
    FOREIGN KEY(task_id) REFERENCES task_items(task_id) ON DELETE CASCADE,
    FOREIGN KEY(thread_id) REFERENCES task_threads(thread_id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS task_agent_bindings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL, agent_id TEXT NOT NULL, runtime_id TEXT NOT NULL,
    runtime_session_id TEXT, cwd TEXT, model TEXT, personality_version TEXT,
    updated_at TEXT NOT NULL, UNIQUE(thread_id, agent_id, runtime_id),
    FOREIGN KEY(thread_id) REFERENCES task_threads(thread_id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS task_agent_runs (
    run_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL, thread_id TEXT NOT NULL, agent_id TEXT NOT NULL,
    runtime_id TEXT NOT NULL, runtime_session_id_at_start TEXT,
    runtime_session_id_at_end TEXT, status TEXT NOT NULL,
    input_artifact_ids TEXT NOT NULL DEFAULT '[]',
    output_artifact_ids TEXT NOT NULL DEFAULT '[]', error TEXT,
    started_at TEXT NOT NULL, ended_at TEXT,
    FOREIGN KEY(task_id) REFERENCES task_items(task_id) ON DELETE CASCADE,
    FOREIGN KEY(thread_id) REFERENCES task_threads(thread_id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS task_agent_progress_events (
    progress_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL, task_id TEXT NOT NULL, thread_id TEXT NOT NULL,
    agent_id TEXT NOT NULL, runtime_id TEXT NOT NULL, phase TEXT NOT NULL,
    summary TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL,
    FOREIGN KEY(run_id) REFERENCES task_agent_runs(run_id) ON DELETE CASCADE,
    FOREIGN KEY(task_id) REFERENCES task_items(task_id) ON DELETE CASCADE,
    FOREIGN KEY(thread_id) REFERENCES task_threads(thread_id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS task_agent_session_events (
    event_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL, task_id TEXT NOT NULL, thread_id TEXT NOT NULL,
    agent_id TEXT NOT NULL, runtime_id TEXT NOT NULL, source TEXT NOT NULL,
    kind TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY(run_id) REFERENCES task_agent_runs(run_id) ON DELETE CASCADE,
    FOREIGN KEY(task_id) REFERENCES task_items(task_id) ON DELETE CASCADE,
    FOREIGN KEY(thread_id) REFERENCES task_threads(thread_id) ON DELETE CASCADE
  );`,
];

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_task_threads_task ON task_threads(task_id, purpose, status)',
  'CREATE INDEX IF NOT EXISTS idx_task_artifacts_thread ON task_artifacts(thread_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_task_attachments_artifact ON task_attachments(artifact_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id, attachment_id)',
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_task_plan_revisions_active_thread ON task_plan_revisions(thread_id) WHERE status = 'active'",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_task_feedback_rounds_open_thread ON task_feedback_rounds(thread_id) WHERE status IN ('open','processing','stale_partial')",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_task_agent_runs_active ON task_agent_runs(thread_id, agent_id, runtime_id) WHERE status = 'running'",
  'CREATE INDEX IF NOT EXISTS idx_task_agent_progress_thread ON task_agent_progress_events(thread_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_task_agent_session_thread ON task_agent_session_events(thread_id, created_at)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_task_items_repo_seq ON task_items(repo_owner, repo_name, seq)',
];

const COLUMN_MIGRATIONS = [
  'ALTER TABLE task_items ADD COLUMN repo_owner TEXT',
  'ALTER TABLE task_items ADD COLUMN repo_name TEXT',
  'ALTER TABLE task_items ADD COLUMN cwd TEXT',
  'ALTER TABLE task_items ADD COLUMN worktree_path TEXT',
  'ALTER TABLE task_items ADD COLUMN branch_name TEXT',
  "ALTER TABLE task_items ADD COLUMN commit_shas TEXT DEFAULT '[]'",
  'ALTER TABLE task_items ADD COLUMN pr_url TEXT',
  'ALTER TABLE task_items ADD COLUMN pr_number INTEGER',
  'ALTER TABLE task_items ADD COLUMN seq INTEGER',
  'ALTER TABLE task_items ADD COLUMN type TEXT',
  "ALTER TABLE task_items ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'manual'",
  "ALTER TABLE task_items ADD COLUMN workspace_mode TEXT NOT NULL DEFAULT 'worktree'",
  "ALTER TABLE task_items ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active'",
  "ALTER TABLE task_items ADD COLUMN current_workflow_kind TEXT NOT NULL DEFAULT 'plan'",
];

interface TableColumnRow {
  name: string;
}

function tableColumns(db: Database, table: string): Set<string> {
  const rows = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as TableColumnRow[];
  return new Set(rows.map((row) => row.name));
}

function renameColumnIfNeeded(
  db: Database,
  table: string,
  from: string,
  to: string,
) {
  const columns = tableColumns(db, table);
  if (!columns.has(from) || columns.has(to)) return;
  db.exec(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
}

function migrateTaskAgentBindingRuntimeColumns(db: Database) {
  renameColumnIfNeeded(db, 'task_agent_bindings', 'provider', 'runtime_id');
  renameColumnIfNeeded(
    db,
    'task_agent_bindings',
    'provider_session_id',
    'runtime_session_id',
  );
}

function migrateTaskAgentRunRuntimeColumns(db: Database) {
  renameColumnIfNeeded(db, 'task_agent_runs', 'provider', 'runtime_id');
  renameColumnIfNeeded(
    db,
    'task_agent_runs',
    'provider_session_id_at_start',
    'runtime_session_id_at_start',
  );
  renameColumnIfNeeded(
    db,
    'task_agent_runs',
    'provider_session_id_at_end',
    'runtime_session_id_at_end',
  );
}

function migrateTaskAgentEventRuntimeColumns(db: Database) {
  renameColumnIfNeeded(
    db,
    'task_agent_progress_events',
    'provider',
    'runtime_id',
  );
  renameColumnIfNeeded(
    db,
    'task_agent_session_events',
    'provider',
    'runtime_id',
  );
}

function migrateTaskAgentRuntimeColumns(db: Database) {
  migrateTaskAgentBindingRuntimeColumns(db);
  migrateTaskAgentRunRuntimeColumns(db);
  migrateTaskAgentEventRuntimeColumns(db);
}

function execRequired(db: Database, statements: string[]) {
  for (const statement of statements) db.exec(statement);
}

function execBestEffort(db: Database, statements: string[]) {
  for (const statement of statements) {
    try {
      db.exec(statement);
    } catch {}
  }
}

const AGENT_ID_RENAMES: Array<{ table: string; column: string }> = [
  { table: 'task_agent_runs', column: 'agent_id' },
  { table: 'task_agent_bindings', column: 'agent_id' },
  { table: 'task_agent_progress_events', column: 'agent_id' },
  { table: 'task_agent_session_events', column: 'agent_id' },
];

const AGENT_ID_MAP: Record<string, string> = {
  planner: 'planning',
  implementer: 'exec',
};

function migrateAgentIds(db: Database) {
  for (const { table, column } of AGENT_ID_RENAMES) {
    for (const [oldId, newId] of Object.entries(AGENT_ID_MAP)) {
      db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(
        newId,
        oldId,
      );
    }
  }
}

export function initSchema(db: Database) {
  execRequired(db, TABLES);
  migrateTaskAgentRuntimeColumns(db);
  migrateAgentIds(db);
  execBestEffort(db, INDEXES);
  execBestEffort(db, COLUMN_MIGRATIONS);
}
