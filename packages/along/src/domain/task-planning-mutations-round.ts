import type { Database } from 'bun:sqlite';
import type { TaskFeedbackRoundRow } from './task-planning-db';
import { generateId, parseStringArray } from './task-planning-db-utils';
import { ROUND_STATUS, THREAD_STATUS } from './task-planning-types';

export function createNewRound(
  db: Database,
  thread: {
    task_id: string;
    thread_id: string;
    current_plan_id: string | null;
  },
  artifactId: string,
  now: string,
): TaskFeedbackRoundRow {
  const roundId = generateId('round');
  const ids = [artifactId];
  db.prepare(
    `INSERT INTO task_feedback_rounds (round_id, task_id, thread_id, based_on_plan_id, feedback_artifact_ids, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    roundId,
    thread.task_id,
    thread.thread_id,
    thread.current_plan_id,
    JSON.stringify(ids),
    ROUND_STATUS.OPEN,
    now,
  );
  db.prepare(
    'UPDATE task_threads SET status = ?, open_round_id = ?, updated_at = ? WHERE thread_id = ?',
  ).run(THREAD_STATUS.DISCUSSING, roundId, now, thread.thread_id);
  return {
    round_id: roundId,
    task_id: thread.task_id,
    thread_id: thread.thread_id,
    based_on_plan_id: thread.current_plan_id ?? '',
    feedback_artifact_ids: JSON.stringify(ids),
    status: ROUND_STATUS.OPEN,
    resolution: null,
    produced_plan_id: null,
    created_at: now,
    resolved_at: null,
  };
}

export function appendToRound(
  db: Database,
  thread: { thread_id: string },
  roundRow: TaskFeedbackRoundRow,
  artifactId: string,
  now: string,
): TaskFeedbackRoundRow {
  const ids = parseStringArray(roundRow.feedback_artifact_ids);
  ids.push(artifactId);
  db.prepare(
    'UPDATE task_feedback_rounds SET feedback_artifact_ids = ?, status = ? WHERE round_id = ?',
  ).run(JSON.stringify(ids), ROUND_STATUS.OPEN, roundRow.round_id);
  db.prepare(
    'UPDATE task_threads SET status = ?, updated_at = ? WHERE thread_id = ?',
  ).run(THREAD_STATUS.DISCUSSING, now, thread.thread_id);
  return {
    ...roundRow,
    feedback_artifact_ids: JSON.stringify(ids),
    status: ROUND_STATUS.OPEN,
  };
}
