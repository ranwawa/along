import { iso_timestamp } from '../../core/common';
import { getDb } from '../../core/db';
import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import {
  ARTIFACT_ROLE,
  ARTIFACT_TYPE,
  readTaskPlanningSnapshot,
  type TaskArtifactRecord,
  type TaskPlanningSnapshot,
  THREAD_STATUS,
} from '../planning';

const CHAT_ARTIFACT_ID_LENGTH = 20;

export interface PublishChatReplyInput {
  taskId: string;
  body: string;
  agentId?: string;
}

function generateChatArtifactId(): string {
  return `art_${crypto
    .randomUUID()
    .replace(/-/g, '')
    .slice(0, CHAT_ARTIFACT_ID_LENGTH)}`;
}

function readChatReplySnapshot(
  input: PublishChatReplyInput,
): Result<{ body: string; snapshot: TaskPlanningSnapshot }> {
  const body = input.body.trim();
  if (!body) return failure('Chat Reply 内容不能为空');

  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${input.taskId}`);
  return success({ body, snapshot });
}

function insertChatReply(input: {
  reply: PublishChatReplyInput;
  snapshot: TaskPlanningSnapshot;
  body: string;
  artifactId: string;
  now: string;
}): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;
  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO task_artifacts (artifact_id, task_id, thread_id, type, role, body, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.artifactId,
      input.snapshot.task.taskId,
      input.snapshot.thread.threadId,
      ARTIFACT_TYPE.CHAT_REPLY,
      ARTIFACT_ROLE.AGENT,
      input.body,
      JSON.stringify({ agentId: input.reply.agentId || 'chat' }),
      input.now,
    );

    db.prepare(
      'UPDATE task_threads SET status = ?, updated_at = ? WHERE thread_id = ?',
    ).run(THREAD_STATUS.DISCUSSING, input.now, input.snapshot.thread.threadId);

    db.prepare('UPDATE task_items SET updated_at = ? WHERE task_id = ?').run(
      input.now,
      input.snapshot.task.taskId,
    );
  });

  txn();
  return success(undefined);
}

function buildChatReplyRecord(input: {
  reply: PublishChatReplyInput;
  snapshot: TaskPlanningSnapshot;
  body: string;
  artifactId: string;
  now: string;
}): TaskArtifactRecord {
  return {
    artifactId: input.artifactId,
    taskId: input.snapshot.task.taskId,
    threadId: input.snapshot.thread.threadId,
    type: ARTIFACT_TYPE.CHAT_REPLY,
    role: ARTIFACT_ROLE.AGENT,
    body: input.body,
    metadata: { agentId: input.reply.agentId || 'chat' },
    attachments: [],
    createdAt: input.now,
  };
}

export function publishChatReply(
  input: PublishChatReplyInput,
): Result<TaskArtifactRecord> {
  const snapshotRes = readChatReplySnapshot(input);
  if (!snapshotRes.success) return snapshotRes;
  const recordInput = {
    ...snapshotRes.data,
    reply: input,
    artifactId: generateChatArtifactId(),
    now: iso_timestamp(),
  };
  const insertRes = insertChatReply(recordInput);
  if (!insertRes.success) return insertRes;
  return success(buildChatReplyRecord(recordInput));
}
