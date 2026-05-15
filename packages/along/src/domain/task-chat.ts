import { iso_timestamp } from '../core/common';
import { getDb } from '../core/db';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  ARTIFACT_ROLE,
  ARTIFACT_TYPE,
  readTaskPlanningSnapshot,
  type TaskArtifactRecord,
  THREAD_STATUS,
} from './task-planning';

export interface PublishChatReplyInput {
  taskId: string;
  body: string;
  agentId?: string;
}

export function publishChatReply(
  input: PublishChatReplyInput,
): Result<TaskArtifactRecord> {
  const body = input.body.trim();
  if (!body) return failure('Chat Reply 内容不能为空');

  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${input.taskId}`);

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  const now = iso_timestamp();
  const artifactId = `art_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO task_artifacts (artifact_id, task_id, thread_id, type, role, body, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      artifactId,
      snapshot.task.taskId,
      snapshot.thread.threadId,
      ARTIFACT_TYPE.CHAT_REPLY,
      ARTIFACT_ROLE.AGENT,
      body,
      JSON.stringify({ agentId: input.agentId || 'chat' }),
      now,
    );

    db.prepare(
      'UPDATE task_threads SET status = ?, updated_at = ? WHERE thread_id = ?',
    ).run(THREAD_STATUS.DISCUSSING, now, snapshot.thread.threadId);

    db.prepare('UPDATE task_items SET updated_at = ? WHERE task_id = ?').run(
      now,
      snapshot.task.taskId,
    );
  });

  txn();

  return success({
    artifactId,
    taskId: snapshot.task.taskId,
    threadId: snapshot.thread.threadId,
    type: ARTIFACT_TYPE.CHAT_REPLY,
    role: ARTIFACT_ROLE.AGENT,
    body,
    metadata: { agentId: input.agentId || 'chat' },
    attachments: [],
    createdAt: now,
  });
}
