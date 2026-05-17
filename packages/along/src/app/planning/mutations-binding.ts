import { iso_timestamp } from '../../core/common';
import { getDb } from '../../core/db';
import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import { mapBinding, type TaskAgentBindingRow } from './db';
import type { EnsureTaskAgentBindingInput } from './inputs';
import type { TaskAgentBindingRecord } from './records';

function readLatestRunRuntimeSession(input: {
  taskId?: string;
  threadId: string;
  agentId: string;
  runtimeId: string;
}): string | undefined {
  const dbRes = getDb();
  if (!dbRes.success) return undefined;
  const row = dbRes.data
    .prepare(
      `SELECT runtime_session_id_at_end FROM task_agent_runs WHERE (thread_id = ? OR (? IS NOT NULL AND task_id = ?)) AND agent_id = ? AND runtime_id = ? AND runtime_session_id_at_end IS NOT NULL ORDER BY COALESCE(ended_at, started_at) DESC LIMIT 1`,
    )
    .get(
      input.threadId,
      input.taskId || null,
      input.taskId || null,
      input.agentId,
      input.runtimeId,
    ) as { runtime_session_id_at_end: string } | null;
  return row?.runtime_session_id_at_end || undefined;
}

type Db =
  ReturnType<typeof getDb> extends { success: true; data: infer D } ? D : never;

function insertAgentBinding(
  db: Db,
  input: EnsureTaskAgentBindingInput,
  now: string,
) {
  const fallbackSession = readLatestRunRuntimeSession({
    taskId: input.taskId,
    threadId: input.threadId,
    agentId: input.agentId,
    runtimeId: input.runtimeId,
  });
  db.prepare(
    `INSERT INTO task_agent_bindings (thread_id, agent_id, runtime_id, runtime_session_id, cwd, model, personality_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.threadId,
    input.agentId,
    input.runtimeId,
    fallbackSession || null,
    input.cwd || null,
    input.model || null,
    input.personalityVersion || null,
    now,
  );
}

function updateAgentBinding(
  db: Db,
  input: EnsureTaskAgentBindingInput,
  existing: TaskAgentBindingRow,
  now: string,
) {
  const shouldResetSession = Boolean(
    input.cwd && existing.cwd && input.cwd !== existing.cwd,
  );
  const fallbackSession = shouldResetSession
    ? undefined
    : readLatestRunRuntimeSession({
        taskId: input.taskId,
        threadId: input.threadId,
        agentId: input.agentId,
        runtimeId: input.runtimeId,
      });
  db.prepare(
    `UPDATE task_agent_bindings SET cwd = COALESCE(?, cwd), model = COALESCE(?, model), personality_version = COALESCE(?, personality_version), runtime_session_id = CASE WHEN ? THEN NULL ELSE COALESCE(runtime_session_id, ?) END, updated_at = ? WHERE thread_id = ? AND agent_id = ? AND runtime_id = ?`,
  ).run(
    input.cwd || null,
    input.model || null,
    input.personalityVersion || null,
    shouldResetSession ? 1 : 0,
    fallbackSession || null,
    now,
    input.threadId,
    input.agentId,
    input.runtimeId,
  );
}

function readAgentBinding(
  db: Db,
  input: EnsureTaskAgentBindingInput,
): TaskAgentBindingRow | null {
  return db
    .prepare(
      'SELECT * FROM task_agent_bindings WHERE thread_id = ? AND agent_id = ? AND runtime_id = ?',
    )
    .get(
      input.threadId,
      input.agentId,
      input.runtimeId,
    ) as TaskAgentBindingRow | null;
}

export function ensureTaskAgentBinding(
  input: EnsureTaskAgentBindingInput,
): Result<TaskAgentBindingRecord> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;
  try {
    const now = iso_timestamp();
    const existing = readAgentBinding(db, input);
    if (!existing) {
      insertAgentBinding(db, input, now);
    } else {
      updateAgentBinding(db, input, existing, now);
    }
    const row = readAgentBinding(db, input);
    return row
      ? success(mapBinding(row))
      : failure('创建 Agent Binding 后读取失败');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`确保 Agent Binding 失败: ${message}`);
  }
}
