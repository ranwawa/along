import type { Database } from 'bun:sqlite';
import { iso_timestamp } from '../core/common';
import { getDb } from '../core/db';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  cleanupPreparedTaskAttachments,
  type PreparedTaskAttachment,
  prepareTaskImageAttachments,
} from './task-attachments';
import {
  insertArtifact,
  insertTaskAttachmentRows,
} from './task-planning-artifact';
import { hasLegacyTaskStatusColumn } from './task-planning-db-compat';
import { generateId } from './task-planning-db-utils';
import type { CreatePlanningTaskInput } from './task-planning-inputs';
import { readTaskPlanningSnapshot } from './task-planning-read';
import type { TaskPlanningSnapshot } from './task-planning-records';
import {
  ARTIFACT_ROLE,
  ARTIFACT_TYPE,
  LIFECYCLE,
  TASK_EXECUTION_MODE,
  TASK_STATUS,
  TASK_WORKSPACE_MODE,
  THREAD_PURPOSE,
  THREAD_STATUS,
  WORKFLOW_KIND,
} from './task-planning-types';

type TaskItemInsertInput = CreatePlanningTaskInput & {
  taskId: string;
  threadId: string;
  seq: number | null;
  now: string;
  workflowKind: string;
};

function insertTaskItemRowLegacy(db: Database, input: TaskItemInsertInput) {
  db.prepare(
    `INSERT INTO task_items (task_id, title, body, source, status, active_thread_id,
      repo_owner, repo_name, cwd, seq, execution_mode, lifecycle,
      current_workflow_kind, workspace_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.taskId,
    input.title.trim(),
    input.body.trim() || '（用户上传了图片）',
    input.source || 'web',
    TASK_STATUS.PLANNING,
    input.threadId,
    input.repoOwner || null,
    input.repoName || null,
    input.cwd || null,
    input.seq,
    input.executionMode || TASK_EXECUTION_MODE.MANUAL,
    LIFECYCLE.ACTIVE,
    input.workflowKind,
    input.workspaceMode || TASK_WORKSPACE_MODE.WORKTREE,
    input.now,
    input.now,
  );
}

function insertTaskItemRowNew(db: Database, input: TaskItemInsertInput) {
  db.prepare(
    `INSERT INTO task_items (task_id, title, body, source, active_thread_id,
      repo_owner, repo_name, cwd, seq, execution_mode, lifecycle,
      current_workflow_kind, workspace_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.taskId,
    input.title.trim(),
    input.body.trim() || '（用户上传了图片）',
    input.source || 'web',
    input.threadId,
    input.repoOwner || null,
    input.repoName || null,
    input.cwd || null,
    input.seq,
    input.executionMode || TASK_EXECUTION_MODE.MANUAL,
    LIFECYCLE.ACTIVE,
    input.workflowKind,
    input.workspaceMode || TASK_WORKSPACE_MODE.WORKTREE,
    input.now,
    input.now,
  );
}

function insertTaskItemRow(db: Database, input: TaskItemInsertInput) {
  if (hasLegacyTaskStatusColumn(db)) {
    insertTaskItemRowLegacy(db, input);
  } else {
    insertTaskItemRowNew(db, input);
  }
}

function insertInitialArtifact(
  input: CreatePlanningTaskInput,
  ids: { taskId: string; threadId: string },
  preparedAttachments: PreparedTaskAttachment[],
  now: string,
) {
  const body = input.body.trim() || '（用户上传了图片）';
  const artifact = insertArtifact({
    taskId: ids.taskId,
    threadId: ids.threadId,
    type: ARTIFACT_TYPE.USER_MESSAGE,
    role: ARTIFACT_ROLE.USER,
    body,
    metadata: {
      kind: 'initial_request',
      repoOwner: input.repoOwner,
      repoName: input.repoName,
      cwd: input.cwd,
      runtimeExecutionMode: input.runtimeExecutionMode,
      attachmentCount: preparedAttachments.length,
    },
    createdAt: now,
  });
  insertTaskAttachmentRows({
    ...ids,
    artifactId: artifact.artifactId,
    attachments: preparedAttachments,
    createdAt: now,
  });
}

function runCreateTaskTxn(
  db: Database,
  input: CreatePlanningTaskInput,
  ids: { taskId: string; threadId: string },
  workflowKind: string,
  preparedAttachments: PreparedTaskAttachment[],
  now: string,
) {
  let seq: number | null = null;
  if (input.repoOwner && input.repoName) {
    const maxRow = db
      .prepare(
        'SELECT MAX(seq) AS max_seq FROM task_items WHERE repo_owner = ? AND repo_name = ?',
      )
      .get(input.repoOwner, input.repoName) as
      | { max_seq: number | null }
      | undefined;
    seq = (maxRow?.max_seq ?? 0) + 1;
  }
  insertTaskItemRow(db, { ...input, ...ids, seq, now, workflowKind });
  db.prepare(
    `INSERT INTO task_threads (thread_id, task_id, purpose, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    ids.threadId,
    ids.taskId,
    workflowKind === WORKFLOW_KIND.PLAN
      ? THREAD_PURPOSE.PLANNING
      : THREAD_PURPOSE.CHAT,
    workflowKind === WORKFLOW_KIND.PLAN
      ? THREAD_STATUS.DRAFTING
      : THREAD_STATUS.ACTIVE,
    now,
    now,
  );
  insertInitialArtifact(input, ids, preparedAttachments, now);
}

function execCreateTaskTxn(
  db: Database,
  input: CreatePlanningTaskInput,
  taskId: string,
  threadId: string,
  workflowKind: string,
  preparedAttachments: PreparedTaskAttachment[],
  now: string,
) {
  db.transaction(() =>
    runCreateTaskTxn(
      db,
      input,
      { taskId, threadId },
      workflowKind,
      preparedAttachments,
      now,
    ),
  )();
}

function prepareAndCreateTask(
  db: Database,
  input: CreatePlanningTaskInput,
  taskId: string,
  threadId: string,
  workflowKind: string,
): Result<TaskPlanningSnapshot> {
  const preparedAttachmentsRes = prepareTaskImageAttachments({
    task: { taskId, repoOwner: input.repoOwner, repoName: input.repoName },
    uploads: input.attachments,
  });
  if (!preparedAttachmentsRes.success) return preparedAttachmentsRes;
  const preparedAttachments = preparedAttachmentsRes.data;
  try {
    const now = iso_timestamp();
    execCreateTaskTxn(
      db,
      input,
      taskId,
      threadId,
      workflowKind,
      preparedAttachments,
      now,
    );
    const snapshot = readTaskPlanningSnapshot(taskId);
    return snapshot.success && snapshot.data
      ? success(snapshot.data)
      : failure('创建 Task 后读取快照失败');
  } catch (error: unknown) {
    cleanupPreparedTaskAttachments(preparedAttachments);
    const message = error instanceof Error ? error.message : String(error);
    return failure(`创建 Task 失败: ${message}`);
  }
}

export function createPlanningTask(
  input: CreatePlanningTaskInput,
): Result<TaskPlanningSnapshot> {
  const title = input.title.trim();
  const body =
    input.body.trim() ||
    (input.attachments?.length ? '（用户上传了图片）' : '');
  if (!title) return failure('Task 标题不能为空');
  if (!body) return failure('Task 内容不能为空');
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const taskId = generateId('task');
  const threadId = generateId('thread');
  const workflowKind = input.workflowKind || WORKFLOW_KIND.PLAN;
  return prepareAndCreateTask(
    dbRes.data,
    input,
    taskId,
    threadId,
    workflowKind,
  );
}
