import type { Database } from 'bun:sqlite';
import { iso_timestamp } from '../core/common';
import { getDb } from '../core/db';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  cleanupPreparedTaskAttachments,
  prepareTaskImageAttachments,
} from './task-attachments';
import {
  insertArtifact,
  insertTaskAttachmentRows,
} from './task-planning-artifact';
import {
  getActiveThreadRow,
  mapRound,
  mapTask,
  type TaskFeedbackRoundRow,
  type TaskItemRow,
  type TaskThreadRow,
} from './task-planning-db';
import { generateId, parseStringArray } from './task-planning-db-utils';
import { hasDeliveryResult } from './task-planning-flow';
import type { SubmitTaskMessageInput } from './task-planning-inputs';
import type {
  TaskArtifactRecord,
  TaskFeedbackRoundRecord,
} from './task-planning-records';
import {
  ARTIFACT_ROLE,
  ARTIFACT_TYPE,
  LIFECYCLE,
  ROUND_STATUS,
  THREAD_PURPOSE,
  THREAD_STATUS,
  WORKFLOW_KIND,
} from './task-planning-types';

function createNewRound(
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

function appendToRound(
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

type PreparedAttachments =
  ReturnType<typeof prepareTaskImageAttachments> extends {
    success: true;
    data: infer D;
  }
    ? D
    : never;

function insertMessageArtifact(
  thread: TaskThreadRow,
  body: string,
  input: SubmitTaskMessageInput,
  preparedAttachments: PreparedAttachments,
  now: string,
): TaskArtifactRecord {
  const artifact = insertArtifact({
    taskId: thread.task_id,
    threadId: thread.thread_id,
    type: ARTIFACT_TYPE.USER_MESSAGE,
    role: ARTIFACT_ROLE.USER,
    body,
    metadata: thread.current_plan_id
      ? {
          kind: 'planning_feedback',
          basedOnPlanId: thread.current_plan_id,
          runtimeExecutionMode: input.runtimeExecutionMode,
          attachmentCount: preparedAttachments.length,
        }
      : {
          kind: 'additional_context',
          runtimeExecutionMode: input.runtimeExecutionMode,
          attachmentCount: preparedAttachments.length,
        },
    createdAt: now,
  });
  insertTaskAttachmentRows({
    taskId: thread.task_id,
    threadId: thread.thread_id,
    artifactId: artifact.artifactId,
    attachments: preparedAttachments,
    createdAt: now,
  });
  return artifact;
}

function handleNoPlanThread(
  db: Database,
  thread: TaskThreadRow,
  now: string,
): { artifact: null; round: null } {
  if (thread.purpose === THREAD_PURPOSE.CHAT) {
    db.prepare(
      'UPDATE task_threads SET status = ?, updated_at = ? WHERE thread_id = ?',
    ).run(THREAD_STATUS.ACTIVE, now, thread.thread_id);
  } else {
    db.prepare(
      'UPDATE task_threads SET updated_at = ? WHERE thread_id = ?',
    ).run(now, thread.thread_id);
  }
  db.prepare('UPDATE task_items SET updated_at = ? WHERE task_id = ?').run(
    now,
    thread.task_id,
  );
  return { artifact: null, round: null };
}

function handlePlanThread(
  db: Database,
  thread: TaskThreadRow,
  artifactId: string,
  now: string,
): TaskFeedbackRoundRecord {
  let roundRow = thread.open_round_id
    ? (db
        .prepare(
          'SELECT * FROM task_feedback_rounds WHERE round_id = ? AND thread_id = ?',
        )
        .get(
          thread.open_round_id,
          thread.thread_id,
        ) as TaskFeedbackRoundRow | null)
    : null;
  roundRow = roundRow
    ? appendToRound(db, thread, roundRow, artifactId, now)
    : createNewRound(db, thread, artifactId, now);
  db.prepare('UPDATE task_items SET updated_at = ? WHERE task_id = ?').run(
    now,
    thread.task_id,
  );
  if (thread.status === THREAD_STATUS.APPROVED) {
    db.prepare(
      'UPDATE task_items SET lifecycle = ?, current_workflow_kind = ?, updated_at = ? WHERE task_id = ?',
    ).run(LIFECYCLE.ACTIVE, WORKFLOW_KIND.PLAN, now, thread.task_id);
  }
  return mapRound(roundRow);
}

function runSubmitMessageTxn(
  db: Database,
  thread: TaskThreadRow,
  body: string,
  input: SubmitTaskMessageInput,
  preparedAttachments: PreparedAttachments,
  now: string,
): { artifact: TaskArtifactRecord; round: TaskFeedbackRoundRecord | null } {
  const artifact = insertMessageArtifact(
    thread,
    body,
    input,
    preparedAttachments,
    now,
  );
  if (!thread.current_plan_id) {
    handleNoPlanThread(db, thread, now);
    return { artifact, round: null };
  }
  const round = handlePlanThread(db, thread, artifact.artifactId, now);
  return { artifact, round };
}

function execSubmitMessageTxn(
  db: Database,
  thread: TaskThreadRow,
  body: string,
  input: SubmitTaskMessageInput,
  preparedAttachments: PreparedAttachments,
  now: string,
): {
  artifact: TaskArtifactRecord;
  round: TaskFeedbackRoundRecord | null;
} | null {
  let result: {
    artifact: TaskArtifactRecord;
    round: TaskFeedbackRoundRecord | null;
  } | null = null;
  db.transaction(() => {
    result = runSubmitMessageTxn(
      db,
      thread,
      body,
      input,
      preparedAttachments,
      now,
    );
  })();
  return result;
}

function runSubmitMessage(
  db: Database,
  thread: TaskThreadRow,
  body: string,
  input: SubmitTaskMessageInput,
  preparedAttachments: PreparedAttachments,
): Result<{
  artifact: TaskArtifactRecord;
  round: TaskFeedbackRoundRecord | null;
}> {
  try {
    const now = iso_timestamp();
    const result = execSubmitMessageTxn(
      db,
      thread,
      body,
      input,
      preparedAttachments,
      now,
    );
    return result ? success(result) : failure('提交消息后缺少 artifact');
  } catch (error: unknown) {
    cleanupPreparedTaskAttachments(preparedAttachments);
    const message = error instanceof Error ? error.message : String(error);
    return failure(`提交 Task 消息失败: ${message}`);
  }
}

export function submitTaskMessage(input: SubmitTaskMessageInput): Result<{
  artifact: TaskArtifactRecord;
  round: TaskFeedbackRoundRecord | null;
}> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;
  const body =
    input.body.trim() ||
    (input.attachments?.length ? '（用户上传了图片）' : '');
  if (!body) return failure('用户消息不能为空');

  const threadRes = getActiveThreadRow(input.taskId);
  if (!threadRes.success) return threadRes;
  const thread = threadRes.data;
  if (!thread)
    return failure(`Task 不存在或缺少 active thread: ${input.taskId}`);

  const taskRow = db
    .prepare('SELECT * FROM task_items WHERE task_id = ?')
    .get(input.taskId) as TaskItemRow | null;
  if (!taskRow) return failure(`Task 不存在: ${input.taskId}`);
  const task = mapTask(taskRow);
  if (task.lifecycle === LIFECYCLE.DONE)
    return failure('Task 已关闭，不能继续讨论');
  if (thread.status === THREAD_STATUS.APPROVED && !hasDeliveryResult(task))
    return failure('当前 Planning 已批准，不能继续提交反馈');

  const preparedAttachmentsRes = prepareTaskImageAttachments({
    task: {
      taskId: thread.task_id,
      repoOwner: taskRow.repo_owner || undefined,
      repoName: taskRow.repo_name || undefined,
    },
    uploads: input.attachments,
  });
  if (!preparedAttachmentsRes.success) return preparedAttachmentsRes;
  return runSubmitMessage(db, thread, body, input, preparedAttachmentsRes.data);
}
