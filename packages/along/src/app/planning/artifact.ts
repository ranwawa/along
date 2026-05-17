import { getDb } from '../../core/db';
import type { PreparedTaskAttachment } from '../task/attachments';
import { generateId } from './db-utils';
import type { TaskArtifactRecord } from './records';
import type { ArtifactRole, ArtifactType } from './types';

export function insertArtifact(input: {
  taskId: string;
  threadId: string;
  type: ArtifactType;
  role: ArtifactRole;
  body: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}): TaskArtifactRecord {
  const dbRes = getDb();
  if (!dbRes.success) throw new Error(dbRes.error);

  const artifactId = generateId('art');
  dbRes.data
    .prepare(
      `
        INSERT INTO task_artifacts (
          artifact_id, task_id, thread_id, type, role, body, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      artifactId,
      input.taskId,
      input.threadId,
      input.type,
      input.role,
      input.body,
      JSON.stringify(input.metadata || {}),
      input.createdAt,
    );

  return {
    artifactId,
    taskId: input.taskId,
    threadId: input.threadId,
    type: input.type,
    role: input.role,
    body: input.body,
    metadata: input.metadata || {},
    attachments: [],
    createdAt: input.createdAt,
  };
}

export function insertTaskAttachmentRows(input: {
  taskId: string;
  threadId: string;
  artifactId: string;
  attachments: PreparedTaskAttachment[];
  createdAt: string;
}) {
  const dbRes = getDb();
  if (!dbRes.success) throw new Error(dbRes.error);
  const statement = dbRes.data.prepare(
    `
      INSERT INTO task_attachments (
        attachment_id, task_id, thread_id, artifact_id, kind, original_name,
        mime_type, size_bytes, sha256, relative_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );
  for (const attachment of input.attachments) {
    statement.run(
      attachment.attachmentId,
      input.taskId,
      input.threadId,
      input.artifactId,
      attachment.kind,
      attachment.originalName,
      attachment.mimeType,
      attachment.sizeBytes,
      attachment.sha256,
      attachment.relativePath,
      input.createdAt,
    );
  }
}
