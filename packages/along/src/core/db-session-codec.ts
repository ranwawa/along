import type { Database } from 'bun:sqlite';
import type { SessionStatus } from '../domain/session-manager';

export interface SessionRow extends Record<string, unknown> {
  id?: number;
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

const SNAKE_TO_CAMEL = Object.fromEntries(
  Object.entries(CAMEL_TO_SNAKE).map(([camel, snake]) => [snake, camel]),
);

function toSnake(key: string): string {
  return CAMEL_TO_SNAKE[key] || key;
}

function toCamel(key: string): string {
  return SNAKE_TO_CAMEL[key] || key;
}

function applyLegacyDefaults(result: Partial<SessionStatus>, row: SessionRow) {
  if (result.lifecycle && result.phase && result.step) return;
  result.lifecycle = result.lifecycle || 'running';
  result.phase = result.phase || 'planning';
  result.step = result.step || 'read_issue';
  result.message = result.message || undefined;
  result.phaseStartedAt =
    result.phaseStartedAt || row.last_update || row.start_time;
  result.stepStartedAt =
    result.stepStartedAt || row.last_update || row.start_time;
}

function applyContextDefaults(result: Partial<SessionStatus>, row: SessionRow) {
  const repoName = `${row.owner}/${row.repo}`;
  if (!result.context) {
    result.context = { issueNumber: row.issue_number, repo: repoName };
    return;
  }
  result.context.issueNumber = result.context.issueNumber || row.issue_number;
  result.context.repo = result.context.repo || repoName;
}

function applyRowValue(
  result: Partial<SessionStatus>,
  snakeKey: string,
  value: unknown,
) {
  const camelKey = toCamel(snakeKey);
  if (JSON_FIELDS.has(camelKey) && typeof value === 'string') {
    try {
      result[camelKey] = JSON.parse(value);
    } catch {
      result[camelKey] = undefined;
    }
    return;
  }
  result[camelKey as keyof SessionStatus] = value as never;
}

export function rowToSessionStatus(row: SessionRow): SessionStatus {
  const result: Partial<SessionStatus> = {};
  for (const [snakeKey, value] of Object.entries(row)) {
    if (snakeKey === 'id' || snakeKey === 'owner' || snakeKey === 'repo') {
      continue;
    }
    applyRowValue(result, snakeKey, value);
  }
  result.repo = { owner: row.owner, name: row.repo };
  applyLegacyDefaults(result, row);
  applyContextDefaults(result, row);
  return result as SessionStatus;
}

function applyRepoColumns(columns: Record<string, unknown>, value: object) {
  const repoValue = value as { owner?: unknown; name?: unknown };
  if (typeof repoValue.owner === 'string') columns.owner = repoValue.owner;
  if (typeof repoValue.name === 'string') columns.repo = repoValue.name;
}

function applyColumnValue(
  columns: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  if (key === 'repo' && value && typeof value === 'object') {
    applyRepoColumns(columns, value);
    return;
  }
  const needsJson =
    JSON_FIELDS.has(key) &&
    value !== null &&
    value !== undefined &&
    typeof value !== 'string';
  columns[toSnake(key)] = needsJson ? JSON.stringify(value) : value;
}

function applyContextColumns(
  columns: Record<string, unknown>,
  context: Partial<SessionStatus>['context'],
) {
  if (context?.branchName !== undefined)
    columns.branch_name = context.branchName;
  if (context?.prUrl !== undefined) columns.pr_url = context.prUrl;
  if (context?.prNumber !== undefined) columns.pr_number = context.prNumber;
  if (context?.reviewCommentCount !== undefined) {
    columns.review_comment_count = context.reviewCommentCount;
  }
}

function applyErrorColumns(
  columns: Record<string, unknown>,
  error: Partial<SessionStatus>['error'],
) {
  if (error?.message !== undefined) columns.error_message = error.message;
  if (error?.details !== undefined) columns.crash_log = error.details;
  if (error?.code && /^EXIT_\d+$/.test(error.code)) {
    columns.exit_code = Number(error.code.replace('EXIT_', ''));
  }
}

function statusToColumns(
  data: Partial<SessionStatus>,
): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    applyColumnValue(columns, key, value);
  }
  applyContextColumns(columns, data.context);
  applyErrorColumns(columns, data.error);
  if (data.message !== undefined) columns.last_message = data.message;
  if (data.step !== undefined) columns.current_step = data.step;
  return columns;
}

function fillInsertDefaults(
  columns: Record<string, unknown>,
  owner: string,
  repo: string,
  issueNumber: number,
) {
  columns.owner = columns.owner || owner;
  columns.repo = columns.repo || repo;
  columns.issue_number = issueNumber;
  columns.start_time = columns.start_time || new Date().toISOString();
  columns.lifecycle = columns.lifecycle || 'running';
  columns.phase = columns.phase || 'planning';
  columns.step = columns.step || 'read_issue';
  columns.context =
    columns.context ||
    JSON.stringify({ issueNumber, repo: `${owner}/${repo}` });
  columns.phase_started_at = columns.phase_started_at || columns.start_time;
  columns.step_started_at = columns.step_started_at || columns.start_time;
}

export function insertSession(
  db: Database,
  owner: string,
  repo: string,
  issueNumber: number,
  data: Partial<SessionStatus>,
) {
  const columns = statusToColumns(data);
  fillInsertDefaults(columns, owner, repo, issueNumber);
  const keys = Object.keys(columns);
  const placeholders = keys.map(() => '?').join(', ');
  const sql = `INSERT INTO sessions (${keys.join(', ')}) VALUES (${placeholders})`;
  db.prepare(sql).run(...keys.map((k) => columns[k]));
}

export function updateSession(
  db: Database,
  owner: string,
  repo: string,
  issueNumber: number,
  data: Partial<SessionStatus>,
): boolean {
  const columns = statusToColumns(data);
  delete columns.owner;
  delete columns.repo;
  delete columns.issue_number;
  if (Object.keys(columns).length === 0) return false;
  const setClauses = Object.keys(columns)
    .map((k) => `${k} = ?`)
    .join(', ');
  const sql = `UPDATE sessions SET ${setClauses} WHERE owner = ? AND repo = ? AND issue_number = ?`;
  db.prepare(sql).run(...Object.values(columns), owner, repo, issueNumber);
  return true;
}

export function readSessionRow(
  db: Database,
  owner: string,
  repo: string,
  issueNumber: number,
): SessionRow | null {
  return db
    .prepare(
      'SELECT * FROM sessions WHERE owner = ? AND repo = ? AND issue_number = ?',
    )
    .get(owner, repo, issueNumber) as SessionRow | null;
}
