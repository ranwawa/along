import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../core/config';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';

export const TASK_ATTACHMENT_LIMITS = {
  maxCount: 6,
  maxSingleBytes: 10 * 1024 * 1024,
  maxTotalBytes: 30 * 1024 * 1024,
} as const;

export const TASK_ATTACHMENT_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

type TaskAttachmentImageMimeType =
  (typeof TASK_ATTACHMENT_IMAGE_MIME_TYPES)[number];

export interface TaskAttachmentUploadInput {
  originalName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface TaskAttachmentRecord {
  attachmentId: string;
  taskId: string;
  threadId: string;
  artifactId: string;
  kind: 'image';
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  relativePath: string;
  createdAt: string;
  missing?: boolean;
}

export interface PreparedTaskAttachment {
  attachmentId: string;
  kind: 'image';
  originalName: string;
  mimeType: TaskAttachmentImageMimeType;
  sizeBytes: number;
  sha256: string;
  relativePath: string;
  absolutePath: string;
}

export interface TaskAttachmentRow {
  attachment_id: string;
  task_id: string;
  thread_id: string;
  artifact_id: string;
  kind: 'image';
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  relative_path: string;
  created_at: string;
}

export interface TaskAttachmentTaskFields {
  taskId: string;
  repoOwner?: string;
  repoName?: string;
}

export interface InputImageAttachment {
  attachmentId: string;
  originalName: string;
  mimeType: string;
  absolutePath: string;
}

export interface ReadTaskAttachmentFileOutput {
  attachment: TaskAttachmentRecord;
  absolutePath: string;
}

const MIME_EXTENSIONS: Record<TaskAttachmentImageMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function isImageMimeType(value: string): value is TaskAttachmentImageMimeType {
  return TASK_ATTACHMENT_IMAGE_MIME_TYPES.includes(
    value as TaskAttachmentImageMimeType,
  );
}

function formatBytes(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10}MB`;
}

function generateAttachmentId(): string {
  return `att_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function detectImageMimeType(bytes: Uint8Array): string | undefined {
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return 'image/gif';
  }
  const header = Buffer.from(bytes.slice(0, 12)).toString('ascii');
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return undefined;
}

function makePreparedAttachment(input: {
  upload: TaskAttachmentUploadInput;
  task: TaskAttachmentTaskFields;
}): PreparedTaskAttachment {
  const attachmentId = generateAttachmentId();
  const mimeType = input.upload.mimeType as TaskAttachmentImageMimeType;
  const extension = MIME_EXTENSIONS[mimeType];
  const relativePath = path.join('attachments', `${attachmentId}.${extension}`);
  const absolutePathRes = getTaskAttachmentAbsolutePath(
    input.task,
    relativePath,
  );
  if (!absolutePathRes.success) throw new Error(absolutePathRes.error);
  const tempPath = `${absolutePathRes.data}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, input.upload.bytes);
  fs.renameSync(tempPath, absolutePathRes.data);
  return {
    attachmentId,
    kind: 'image',
    originalName: path.basename(input.upload.originalName || 'image'),
    mimeType,
    sizeBytes: input.upload.bytes.byteLength,
    sha256: crypto
      .createHash('sha256')
      .update(input.upload.bytes)
      .digest('hex'),
    relativePath,
    absolutePath: absolutePathRes.data,
  };
}

function validateUploads(
  uploads: TaskAttachmentUploadInput[] | undefined,
): Result<TaskAttachmentUploadInput[]> {
  const items = uploads || [];
  if (items.length > TASK_ATTACHMENT_LIMITS.maxCount) {
    return failure(`单次最多上传 ${TASK_ATTACHMENT_LIMITS.maxCount} 张图片`);
  }
  const totalBytes = items.reduce(
    (sum, item) => sum + item.bytes.byteLength,
    0,
  );
  if (totalBytes > TASK_ATTACHMENT_LIMITS.maxTotalBytes) {
    return failure(
      `单次图片总大小不能超过 ${formatBytes(
        TASK_ATTACHMENT_LIMITS.maxTotalBytes,
      )}`,
    );
  }
  for (const item of items) {
    const size = item.bytes.byteLength;
    if (size <= 0) return failure('不能上传空图片文件');
    if (size > TASK_ATTACHMENT_LIMITS.maxSingleBytes) {
      return failure(
        `单张图片不能超过 ${formatBytes(
          TASK_ATTACHMENT_LIMITS.maxSingleBytes,
        )}`,
      );
    }
    if (!isImageMimeType(item.mimeType)) {
      return failure('只支持上传 PNG、JPEG、WebP 或 GIF 图片');
    }
    const detected = detectImageMimeType(item.bytes);
    if (!detected || detected !== item.mimeType) {
      return failure('无法识别图片类型或图片 MIME 与内容不匹配');
    }
  }
  return success(items);
}

export function getTaskAttachmentBaseDir(
  task: TaskAttachmentTaskFields,
): string {
  if (task.repoOwner && task.repoName) {
    return config.getTaskDir(task.repoOwner, task.repoName, task.taskId);
  }
  return path.join(config.USER_ALONG_DIR, 'tasks', task.taskId);
}

export function getTaskAttachmentAbsolutePath(
  task: TaskAttachmentTaskFields,
  relativePath: string,
): Result<string> {
  const baseDir = path.resolve(getTaskAttachmentBaseDir(task));
  const absolutePath = path.resolve(baseDir, relativePath);
  if (
    absolutePath !== baseDir &&
    !absolutePath.startsWith(`${baseDir}${path.sep}`)
  ) {
    return failure('附件路径非法');
  }
  return success(absolutePath);
}

export function mapTaskAttachment(
  row: TaskAttachmentRow,
  task: TaskAttachmentTaskFields,
): TaskAttachmentRecord {
  const absolutePathRes = getTaskAttachmentAbsolutePath(
    task,
    row.relative_path,
  );
  const missing =
    !absolutePathRes.success || !fs.existsSync(absolutePathRes.data);
  return {
    attachmentId: row.attachment_id,
    taskId: row.task_id,
    threadId: row.thread_id,
    artifactId: row.artifact_id,
    kind: 'image',
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    relativePath: row.relative_path,
    createdAt: row.created_at,
    missing: missing || undefined,
  };
}

export function prepareTaskImageAttachments(input: {
  task: TaskAttachmentTaskFields;
  uploads?: TaskAttachmentUploadInput[];
}): Result<PreparedTaskAttachment[]> {
  const validation = validateUploads(input.uploads);
  if (!validation.success) return failure(validation.error);
  if (validation.data.length === 0) return success([]);

  const attachmentsDir = path.join(
    getTaskAttachmentBaseDir(input.task),
    'attachments',
  );
  const prepared: PreparedTaskAttachment[] = [];
  try {
    fs.mkdirSync(attachmentsDir, { recursive: true });
    for (const upload of validation.data) {
      prepared.push(makePreparedAttachment({ upload, task: input.task }));
    }
    return success(prepared);
  } catch (error: unknown) {
    cleanupPreparedTaskAttachments(prepared);
    const message = error instanceof Error ? error.message : String(error);
    return failure(`保存图片附件失败: ${message}`);
  }
}

export function cleanupPreparedTaskAttachments(
  attachments: PreparedTaskAttachment[],
) {
  for (const attachment of attachments) {
    try {
      fs.rmSync(attachment.absolutePath, { force: true });
    } catch {}
  }
}
