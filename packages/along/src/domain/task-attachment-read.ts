import fs from 'node:fs';
import { getDb } from '../core/db';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  getTaskAttachmentAbsolutePath,
  type InputImageAttachment,
  mapTaskAttachment,
  type ReadTaskAttachmentFileOutput,
  type TaskAttachmentRow,
  type TaskAttachmentTaskFields,
} from './task-attachments';

interface TaskAttachmentTaskRow {
  task_id: string;
  repo_owner: string | null;
  repo_name: string | null;
}

function readTaskRow(taskId: string): Result<TaskAttachmentTaskFields | null> {
  const dbRes = getDb();
  if (!dbRes.success) return failure(dbRes.error);
  try {
    const row = dbRes.data
      .prepare(
        'SELECT task_id, repo_owner, repo_name FROM task_items WHERE task_id = ?',
      )
      .get(taskId) as TaskAttachmentTaskRow | null;
    return success(
      row
        ? {
            taskId: row.task_id,
            repoOwner: row.repo_owner || undefined,
            repoName: row.repo_name || undefined,
          }
        : null,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`读取 Task 附件目录失败: ${message}`);
  }
}

function mapInputImageRows(input: {
  rows: TaskAttachmentRow[];
  task: TaskAttachmentTaskFields;
}): Result<InputImageAttachment[]> {
  const images: InputImageAttachment[] = [];
  for (const row of input.rows) {
    const absolutePathRes = getTaskAttachmentAbsolutePath(
      input.task,
      row.relative_path,
    );
    if (!absolutePathRes.success) return failure(absolutePathRes.error);
    if (!fs.existsSync(absolutePathRes.data)) {
      return failure(`图片附件文件缺失: ${row.original_name}`);
    }
    images.push({
      attachmentId: row.attachment_id,
      originalName: row.original_name,
      mimeType: row.mime_type,
      absolutePath: absolutePathRes.data,
    });
  }
  return success(images);
}

export function resolveInputImageAttachments(input: {
  taskId: string;
  inputArtifactIds?: string[];
}): Result<InputImageAttachment[]> {
  const artifactIds = input.inputArtifactIds || [];
  if (artifactIds.length === 0) return success([]);

  const taskRes = readTaskRow(input.taskId);
  if (!taskRes.success) return failure(taskRes.error);
  if (!taskRes.data) return failure(`Task 不存在: ${input.taskId}`);

  const dbRes = getDb();
  if (!dbRes.success) return failure(dbRes.error);
  try {
    const placeholders = artifactIds.map(() => '?').join(',');
    const rows = dbRes.data
      .prepare(
        `
          SELECT * FROM task_attachments
          WHERE task_id = ? AND artifact_id IN (${placeholders})
          ORDER BY created_at ASC
        `,
      )
      .all(input.taskId, ...artifactIds) as TaskAttachmentRow[];
    return mapInputImageRows({ rows, task: taskRes.data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`读取输入图片附件失败: ${message}`);
  }
}

export function readTaskAttachmentFile(input: {
  taskId: string;
  attachmentId: string;
}): Result<ReadTaskAttachmentFileOutput> {
  const dbRes = getDb();
  if (!dbRes.success) return failure(dbRes.error);
  try {
    const row = dbRes.data
      .prepare('SELECT * FROM task_attachments WHERE attachment_id = ?')
      .get(input.attachmentId) as TaskAttachmentRow | null;
    if (!row) return failure('附件不存在');
    if (row.task_id !== input.taskId) return failure('附件不属于当前 Task');

    return readTaskAttachmentFileForRow(input.taskId, row);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`读取图片附件失败: ${message}`);
  }
}

function readTaskAttachmentFileForRow(
  taskId: string,
  row: TaskAttachmentRow,
): Result<ReadTaskAttachmentFileOutput> {
  const taskRes = readTaskRow(taskId);
  if (!taskRes.success) return failure(taskRes.error);
  if (!taskRes.data) return failure(`Task 不存在: ${taskId}`);
  const absolutePathRes = getTaskAttachmentAbsolutePath(
    taskRes.data,
    row.relative_path,
  );
  if (!absolutePathRes.success) return failure(absolutePathRes.error);
  if (!fs.existsSync(absolutePathRes.data)) return failure('附件文件不存在');
  return success({
    attachment: mapTaskAttachment(row, taskRes.data),
    absolutePath: absolutePathRes.data,
  });
}
