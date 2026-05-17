import { iso_timestamp } from '../../core/common';
import { getDb } from '../../core/db';
import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import type {
  CreateTaskAgentRunInput,
  RecordTaskAgentProgressInput,
  RecordTaskAgentSessionEventInput,
} from './';
import {
  AGENT_RUN_STATUS,
  generateId,
  LIFECYCLE,
  mapBinding,
  mapRun,
  normalizeLifecycle,
  normalizeSessionEventContent,
  TASK_AGENT_PROGRESS_PHASE,
  type TaskAgentBindingRecord,
  type TaskAgentBindingRow,
  type TaskAgentProgressEventRecord,
  type TaskAgentProgressEventRow,
  type TaskAgentRunRecord,
  type TaskAgentRunRow,
  type TaskAgentSessionEventRecord,
  type TaskAgentSessionEventRow,
  type TaskItemRow,
} from './';

export function readTaskAgentBinding(
  threadId: string,
  agentId: string,
  runtimeId: string,
): Result<TaskAgentBindingRecord | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const row = dbRes.data
      .prepare(
        `
          SELECT * FROM task_agent_bindings
          WHERE thread_id = ? AND agent_id = ? AND runtime_id = ?
        `,
      )
      .get(threadId, agentId, runtimeId) as TaskAgentBindingRow | null;
    return success(row ? mapBinding(row) : null);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`读取 Agent Binding 失败: ${message}`);
  }
}

export function updateTaskAgentRuntimeSession(
  threadId: string,
  agentId: string,
  runtimeId: string,
  runtimeSessionId: string,
): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    dbRes.data
      .prepare(
        `
          UPDATE task_agent_bindings
          SET runtime_session_id = ?, updated_at = ?
          WHERE thread_id = ? AND agent_id = ? AND runtime_id = ?
        `,
      )
      .run(runtimeSessionId, iso_timestamp(), threadId, agentId, runtimeId);
    return success(undefined);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`更新 Codex session 失败: ${message}`);
  }
}

function insertProgressEvent(
  input: RecordTaskAgentProgressInput,
  progressId: string,
  summary: string,
  detail: string | undefined,
  createdAt: string,
): void {
  const dbRes = getDb();
  if (!dbRes.success) throw new Error(dbRes.error);
  dbRes.data
    .prepare(
      `
        INSERT INTO task_agent_progress_events (
          progress_id, run_id, task_id, thread_id, agent_id, runtime_id,
          phase, summary, detail, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      progressId,
      input.runId,
      input.taskId,
      input.threadId,
      input.agentId,
      input.runtimeId,
      input.phase,
      summary,
      detail || null,
      createdAt,
    );
}

export function recordTaskAgentProgress(
  input: RecordTaskAgentProgressInput,
): Result<TaskAgentProgressEventRecord> {
  const summary = input.summary.trim();
  if (!summary) return failure('Agent Progress 摘要不能为空');
  const detail = input.detail?.trim();
  const progressId = generateId('prog');
  const createdAt = iso_timestamp();

  try {
    insertProgressEvent(input, progressId, summary, detail, createdAt);
    return success({
      progressId,
      runId: input.runId,
      taskId: input.taskId,
      threadId: input.threadId,
      agentId: input.agentId,
      runtimeId: input.runtimeId,
      phase: input.phase,
      summary,
      detail: detail || undefined,
      createdAt,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`记录 Agent Progress 失败: ${message}`);
  }
}

function insertSessionEvent(
  input: RecordTaskAgentSessionEventInput,
  eventId: string,
  content: string,
  createdAt: string,
): void {
  const dbRes = getDb();
  if (!dbRes.success) throw new Error(dbRes.error);
  dbRes.data
    .prepare(
      `
        INSERT INTO task_agent_session_events (
          event_id, run_id, task_id, thread_id, agent_id, runtime_id,
          source, kind, content, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      eventId,
      input.runId,
      input.taskId,
      input.threadId,
      input.agentId,
      input.runtimeId,
      input.source,
      input.kind,
      content,
      JSON.stringify(input.metadata || {}),
      createdAt,
    );
}

export function recordTaskAgentSessionEvent(
  input: RecordTaskAgentSessionEventInput,
): Result<TaskAgentSessionEventRecord> {
  const content = normalizeSessionEventContent(input.content);
  if (!content) return failure('Agent Session 内容不能为空');
  const eventId = generateId('sess');
  const createdAt = iso_timestamp();

  try {
    insertSessionEvent(input, eventId, content, createdAt);
    return success({
      eventId,
      runId: input.runId,
      taskId: input.taskId,
      threadId: input.threadId,
      agentId: input.agentId,
      runtimeId: input.runtimeId,
      source: input.source,
      kind: input.kind,
      content,
      metadata: input.metadata || {},
      createdAt,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`记录 Agent Session 事件失败: ${message}`);
  }
}

function insertAgentRun(
  input: CreateTaskAgentRunInput,
  runId: string,
  inputArtifactIds: string[],
  now: string,
): void {
  const dbRes = getDb();
  if (!dbRes.success) throw new Error(dbRes.error);
  dbRes.data
    .prepare(
      `
        INSERT INTO task_agent_runs (
          run_id, task_id, thread_id, agent_id, runtime_id,
          runtime_session_id_at_start, status, input_artifact_ids, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      runId,
      input.taskId,
      input.threadId,
      input.agentId,
      input.runtimeId,
      input.runtimeSessionIdAtStart || null,
      AGENT_RUN_STATUS.RUNNING,
      JSON.stringify(inputArtifactIds),
      now,
    );
}

export function createTaskAgentRun(
  input: CreateTaskAgentRunInput,
): Result<TaskAgentRunRecord> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const runId = generateId('run');
  const now = iso_timestamp();
  const inputArtifactIds = input.inputArtifactIds || [];

  try {
    const taskRow = dbRes.data
      .prepare('SELECT * FROM task_items WHERE task_id = ?')
      .get(input.taskId) as TaskItemRow | null;
    if (!taskRow) return failure(`Task 不存在: ${input.taskId}`);
    if (normalizeLifecycle(taskRow.lifecycle) === LIFECYCLE.DONE) {
      return failure('Task 已关闭，不能创建 Agent Run');
    }
    insertAgentRun(input, runId, inputArtifactIds, now);
    return success({
      runId,
      taskId: input.taskId,
      threadId: input.threadId,
      agentId: input.agentId,
      runtimeId: input.runtimeId,
      runtimeSessionIdAtStart: input.runtimeSessionIdAtStart,
      status: AGENT_RUN_STATUS.RUNNING,
      inputArtifactIds,
      outputArtifactIds: [],
      startedAt: now,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`创建 Agent Run 失败: ${message}`);
  }
}

export function readTaskAgentRun(
  runId: string,
): Result<TaskAgentRunRecord | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const row = dbRes.data
      .prepare('SELECT * FROM task_agent_runs WHERE run_id = ?')
      .get(runId) as TaskAgentRunRow | null;
    return success(row ? mapRun(row) : null);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`读取 Agent Run 失败: ${message}`);
  }
}

export {
  AGENT_RUN_STATUS,
  TASK_AGENT_PROGRESS_PHASE,
  type TaskAgentProgressEventRow,
  type TaskAgentSessionEventRow,
};
