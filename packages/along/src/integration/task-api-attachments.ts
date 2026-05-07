import { readFileSync } from 'node:fs';
import { errorResponse } from './task-api-utils';

export async function readTaskAttachmentResponse(
  taskId: string,
  attachmentId: string,
): Promise<Response> {
  const { readTaskAttachmentFile } = await import(
    '../domain/task-attachment-read'
  );
  const fileRes = readTaskAttachmentFile({ taskId, attachmentId });
  if (!fileRes.success) {
    const status = getAttachmentErrorStatus(fileRes.error);
    return errorResponse(fileRes.error, status);
  }
  return new Response(readFileSync(fileRes.data.absolutePath), {
    status: 200,
    headers: {
      'Content-Type': fileRes.data.attachment.mimeType,
      'Cache-Control': 'private, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function getAttachmentErrorStatus(error: string): number {
  if (error.includes('不属于当前 Task')) return 403;
  if (error.includes('不存在')) return 404;
  return 400;
}
