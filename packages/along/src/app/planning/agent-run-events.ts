import type { Database } from 'bun:sqlite';
import { iso_timestamp } from '../../core/common';
import { getDb } from '../../core/db';
import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import type {
  CancelTaskAgentRunInput,
  CancelTaskAgentRunOutput,
  FinishTaskAgentRunInput,
  RecoverInterruptedTaskAgentRunsOutput,
} from './';
import {
  AGENT_RUN_STATUS,
  mapRun,
  TASK_AGENT_PROGRESS_PHASE,
  type TaskAgentRunRecord,
  type TaskAgentRunRow,
  type TaskIdRow,
  transitionTaskWorkflow,
} from './';
import {
  recordTaskAgentProgress,
  recordTaskAgentSessionEvent,
} from './agent-run';

function findCancelableTaskAgentRun(
  db: Database,
  input: CancelTaskAgentRunInput,
): Result<TaskAgentRunRow | null> {
  const taskRow = db
    .prepare('SELECT task_id FROM task_items WHERE task_id = ?')
    .get(input.taskId) as TaskIdRow | null;
  if (!taskRow) return failure(`Task 不存在: ${input.taskId}`);

  const row = input.runId
    ? (db
        .prepare(
          `
            SELECT * FROM task_agent_runs
            WHERE task_id = ? AND run_id = ? AND status = ?
            LIMIT 1
          `,
        )
        .get(
          input.taskId,
          input.runId,
          AGENT_RUN_STATUS.RUNNING,
        ) as TaskAgentRunRow | null)
    : (db
        .prepare(
          `
            SELECT * FROM task_agent_runs
            WHERE task_id = ? AND status = ?
            ORDER BY started_at DESC
            LIMIT 1
          `,
        )
        .get(input.taskId, AGENT_RUN_STATUS.RUNNING) as TaskAgentRunRow | null);
  return success(row);
}

function recordTaskAgentCancelledProgress(
  run: TaskAgentRunRecord,
  reason?: string,
): Result<void> {
  const detail = reason?.trim() || undefined;
  const summary = 'Agent 运行已被用户中断。';
  const progressRes = recordTaskAgentProgress({
    runId: run.runId,
    taskId: run.taskId,
    threadId: run.threadId,
    agentId: run.agentId,
    runtimeId: run.runtimeId,
    phase: TASK_AGENT_PROGRESS_PHASE.CANCELLED,
    summary,
    detail,
  });
  if (!progressRes.success) return failure(progressRes.error);

  const sessionRes = recordTaskAgentSessionEvent({
    runId: run.runId,
    taskId: run.taskId,
    threadId: run.threadId,
    agentId: run.agentId,
    runtimeId: run.runtimeId,
    source: 'system',
    kind: 'progress',
    content: detail ? `${summary}\n${detail}` : summary,
    metadata: { phase: TASK_AGENT_PROGRESS_PHASE.CANCELLED },
  });
  return sessionRes.success ? success(undefined) : failure(sessionRes.error);
}

export function cancelTaskAgentRun(
  input: CancelTaskAgentRunInput,
): Result<CancelTaskAgentRunOutput> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  const rowRes = findCancelableTaskAgentRun(dbRes.data, input);
  if (!rowRes.success) return rowRes;
  if (!rowRes.data) return success({ cancelled: false });

  const runningRun = mapRun(rowRes.data);
  const progressRes = recordTaskAgentCancelledProgress(
    runningRun,
    input.reason,
  );
  if (!progressRes.success) return progressRes;

  const finishRes = finishTaskAgentRun({
    runId: runningRun.runId,
    status: AGENT_RUN_STATUS.CANCELLED,
    error: input.reason,
  });
  if (!finishRes.success) return finishRes;
  return success({
    cancelled: finishRes.data.status === AGENT_RUN_STATUS.CANCELLED,
    runId: finishRes.data.runId,
    run: finishRes.data,
  });
}

export function finishTaskAgentRun(
  input: FinishTaskAgentRunInput,
): Result<TaskAgentRunRecord> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const endedAt = iso_timestamp();

  try {
    const existingRow = dbRes.data
      .prepare('SELECT * FROM task_agent_runs WHERE run_id = ?')
      .get(input.runId) as TaskAgentRunRow | null;
    if (!existingRow) return failure('结束 Agent Run 后读取失败');
    if (existingRow.status !== AGENT_RUN_STATUS.RUNNING) {
      return success(mapRun(existingRow));
    }
    dbRes.data
      .prepare(
        `
          UPDATE task_agent_runs
          SET status = ?,
              runtime_session_id_at_end = ?,
              output_artifact_ids = ?,
              error = ?,
              ended_at = ?
          WHERE run_id = ?
        `,
      )
      .run(
        input.status,
        input.runtimeSessionIdAtEnd || null,
        JSON.stringify(input.outputArtifactIds || []),
        input.error || null,
        endedAt,
        input.runId,
      );

    const row = dbRes.data
      .prepare('SELECT * FROM task_agent_runs WHERE run_id = ?')
      .get(input.runId) as TaskAgentRunRow | null;
    return row ? success(mapRun(row)) : failure('结束 Agent Run 后读取失败');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`结束 Agent Run 失败: ${message}`);
  }
}

function recoverSingleRun(
  row: TaskAgentRunRow,
  reason: string,
  resetTaskIds: Set<string>,
): Result<TaskAgentRunRecord> {
  const finishRes = finishTaskAgentRun({
    runId: String(row.run_id),
    status: AGENT_RUN_STATUS.FAILED,
    runtimeSessionIdAtEnd:
      typeof row.runtime_session_id_at_end === 'string'
        ? row.runtime_session_id_at_end
        : undefined,
    error: reason,
  });
  if (!finishRes.success) return finishRes;

  if (row.agent_id === 'implementer' || row.agent_id === 'delivery') {
    const resetRes = transitionTaskWorkflow({
      taskId: String(row.task_id),
      event: { type: 'recovery.interrupted' },
    });
    if (!resetRes.success) return resetRes;
    resetTaskIds.add(String(row.task_id));
  }
  return finishRes;
}

export function recoverInterruptedTaskAgentRuns(
  reason = 'Agent 运行被中断：服务进程在 run 完成前退出或重启。',
): Result<RecoverInterruptedTaskAgentRunsOutput> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const rows = dbRes.data
      .prepare(
        'SELECT * FROM task_agent_runs WHERE status = ? ORDER BY started_at ASC',
      )
      .all(AGENT_RUN_STATUS.RUNNING) as TaskAgentRunRow[];

    const recoveredRuns: TaskAgentRunRecord[] = [];
    const resetTaskIds = new Set<string>();

    for (const row of rows) {
      const res = recoverSingleRun(row, reason, resetTaskIds);
      if (!res.success) return res;
      recoveredRuns.push(res.data);
    }

    return success({ recoveredRuns, resetTaskIds: [...resetTaskIds] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`恢复中断的 Agent Run 失败: ${message}`);
  }
}
