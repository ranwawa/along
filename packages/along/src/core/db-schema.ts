import type { Database } from 'bun:sqlite';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL, repo TEXT NOT NULL, issue_number INTEGER NOT NULL,
    lifecycle TEXT, phase TEXT, step TEXT, message TEXT, progress TEXT,
    context TEXT, error TEXT, start_time TEXT NOT NULL, end_time TEXT,
    phase_started_at TEXT, step_started_at TEXT, worktree_path TEXT DEFAULT '',
    title TEXT DEFAULT '', agent_role TEXT, agent_type TEXT, agent_command TEXT,
    pid INTEGER, last_update TEXT, retry_count INTEGER DEFAULT 0,
    ci_results TEXT, environment TEXT, status TEXT, branch_name TEXT DEFAULT '',
    pr_url TEXT, pr_number INTEGER, commit_shas TEXT DEFAULT '[]',
    last_message TEXT, current_step TEXT, error_message TEXT, exit_code INTEGER,
    crash_log TEXT, review_comment_count INTEGER, workflow_phase TEXT,
    claude_session_id TEXT, UNIQUE(owner, repo, issue_number)
  );`,
  `CREATE TABLE IF NOT EXISTS planning_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL, repo TEXT NOT NULL, issue_number INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, is_closed INTEGER NOT NULL DEFAULT 0,
    current_plan_id TEXT, open_round_id TEXT, approved_plan_id TEXT,
    last_processed_comment_id INTEGER, updated_at TEXT NOT NULL,
    UNIQUE(owner, repo, issue_number)
  );`,
  `CREATE TABLE IF NOT EXISTS plan_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL, repo TEXT NOT NULL, issue_number INTEGER NOT NULL,
    plan_id TEXT NOT NULL, version INTEGER NOT NULL, based_on_plan_id TEXT,
    status TEXT NOT NULL, comment_id INTEGER NOT NULL, summary TEXT, scope TEXT,
    changes TEXT, risks TEXT, validation TEXT, decision_log TEXT,
    changes_since_last_version TEXT, body TEXT, created_at TEXT NOT NULL,
    UNIQUE(plan_id), UNIQUE(owner, repo, issue_number, version)
  );`,
  `CREATE TABLE IF NOT EXISTS discussion_rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL, repo TEXT NOT NULL, issue_number INTEGER NOT NULL,
    round_id TEXT NOT NULL, based_on_plan_id TEXT,
    snapshot_comment_ids TEXT NOT NULL DEFAULT '[]',
    snapshot_last_seen_comment_id INTEGER, status TEXT NOT NULL, resolution TEXT,
    produced_plan_id TEXT, created_at TEXT NOT NULL, resolved_at TEXT,
    UNIQUE(round_id)
  );`,
  `CREATE TABLE IF NOT EXISTS comment_mirror (
    comment_id INTEGER PRIMARY KEY,
    owner TEXT NOT NULL, repo TEXT NOT NULL, issue_number INTEGER NOT NULL,
    author_login TEXT NOT NULL, author_type TEXT NOT NULL, body TEXT NOT NULL,
    created_at TEXT NOT NULL, mirrored_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS task_items (
    task_id TEXT PRIMARY KEY,
    title TEXT NOT NULL, body TEXT NOT NULL, source TEXT NOT NULL,
    status TEXT NOT NULL, active_thread_id TEXT, repo_owner TEXT, repo_name TEXT,
    cwd TEXT, worktree_path TEXT, branch_name TEXT, commit_shas TEXT DEFAULT '[]',
    pr_url TEXT, pr_number INTEGER, seq INTEGER, type TEXT,
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
    thread_id TEXT NOT NULL, agent_id TEXT NOT NULL, provider TEXT NOT NULL,
    provider_session_id TEXT, cwd TEXT, model TEXT, personality_version TEXT,
    updated_at TEXT NOT NULL, UNIQUE(thread_id, agent_id, provider),
    FOREIGN KEY(thread_id) REFERENCES task_threads(thread_id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS task_agent_runs (
    run_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL, thread_id TEXT NOT NULL, agent_id TEXT NOT NULL,
    provider TEXT NOT NULL, provider_session_id_at_start TEXT,
    provider_session_id_at_end TEXT, status TEXT NOT NULL,
    input_artifact_ids TEXT NOT NULL DEFAULT '[]',
    output_artifact_ids TEXT NOT NULL DEFAULT '[]', error TEXT,
    started_at TEXT NOT NULL, ended_at TEXT,
    FOREIGN KEY(task_id) REFERENCES task_items(task_id) ON DELETE CASCADE,
    FOREIGN KEY(thread_id) REFERENCES task_threads(thread_id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS task_agent_progress_events (
    progress_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL, task_id TEXT NOT NULL, thread_id TEXT NOT NULL,
    agent_id TEXT NOT NULL, provider TEXT NOT NULL, phase TEXT NOT NULL,
    summary TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL,
    FOREIGN KEY(run_id) REFERENCES task_agent_runs(run_id) ON DELETE CASCADE,
    FOREIGN KEY(task_id) REFERENCES task_items(task_id) ON DELETE CASCADE,
    FOREIGN KEY(thread_id) REFERENCES task_threads(thread_id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS task_agent_session_events (
    event_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL, task_id TEXT NOT NULL, thread_id TEXT NOT NULL,
    agent_id TEXT NOT NULL, provider TEXT NOT NULL, source TEXT NOT NULL,
    kind TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY(run_id) REFERENCES task_agent_runs(run_id) ON DELETE CASCADE,
    FOREIGN KEY(task_id) REFERENCES task_items(task_id) ON DELETE CASCADE,
    FOREIGN KEY(thread_id) REFERENCES task_threads(thread_id) ON DELETE CASCADE
  );`,
];

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_sessions_lifecycle ON sessions(lifecycle)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_pr_number ON sessions(pr_number)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_branch ON sessions(branch_name)',
  'CREATE INDEX IF NOT EXISTS idx_plan_revisions_issue ON plan_revisions(owner, repo, issue_number, version)',
  'CREATE INDEX IF NOT EXISTS idx_discussion_rounds_issue ON discussion_rounds(owner, repo, issue_number, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_comment_mirror_issue ON comment_mirror(owner, repo, issue_number, comment_id)',
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_revisions_active_issue ON plan_revisions(owner, repo, issue_number) WHERE status = 'active'",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_discussion_rounds_open_issue ON discussion_rounds(owner, repo, issue_number) WHERE status IN ('open','processing','stale_partial')",
  'CREATE INDEX IF NOT EXISTS idx_task_items_status ON task_items(status, updated_at)',
  'CREATE INDEX IF NOT EXISTS idx_task_threads_task ON task_threads(task_id, purpose, status)',
  'CREATE INDEX IF NOT EXISTS idx_task_artifacts_thread ON task_artifacts(thread_id, created_at)',
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_task_plan_revisions_active_thread ON task_plan_revisions(thread_id) WHERE status = 'active'",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_task_feedback_rounds_open_thread ON task_feedback_rounds(thread_id) WHERE status IN ('open','processing','stale_partial')",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_task_agent_runs_active ON task_agent_runs(thread_id, agent_id, provider) WHERE status = 'running'",
  'CREATE INDEX IF NOT EXISTS idx_task_agent_progress_thread ON task_agent_progress_events(thread_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_task_agent_session_thread ON task_agent_session_events(thread_id, created_at)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_task_items_repo_seq ON task_items(repo_owner, repo_name, seq)',
];

const COLUMN_MIGRATIONS = [
  'ALTER TABLE sessions ADD COLUMN lifecycle TEXT',
  'ALTER TABLE sessions ADD COLUMN phase TEXT',
  'ALTER TABLE sessions ADD COLUMN step TEXT',
  'ALTER TABLE sessions ADD COLUMN message TEXT',
  'ALTER TABLE sessions ADD COLUMN progress TEXT',
  'ALTER TABLE sessions ADD COLUMN context TEXT',
  'ALTER TABLE sessions ADD COLUMN error TEXT',
  'ALTER TABLE sessions ADD COLUMN phase_started_at TEXT',
  'ALTER TABLE sessions ADD COLUMN step_started_at TEXT',
  'ALTER TABLE sessions ADD COLUMN claude_session_id TEXT',
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
];

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

export function initSchema(db: Database) {
  execRequired(db, TABLES);
  execBestEffort(db, INDEXES);
  execBestEffort(db, COLUMN_MIGRATIONS);
}
