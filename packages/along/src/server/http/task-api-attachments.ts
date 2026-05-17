import { readFileSync } from 'node:fs';
import {
  HTTP_BAD_REQUEST,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  HTTP_OK,
} from './http-status';
import { errorResponse } from './task-api-utils';

export async function readTaskAttachmentResponse(
  taskId: string,
  attachmentId: string,
): Promise<Response> {
  const { readTaskAttachmentFile } = await import(
    '../../app/task/attachment-read'
  );
  const fileRes = readTaskAttachmentFile({ taskId, attachmentId });
  if (!fileRes.success) {
    const status = getAttachmentErrorStatus(fileRes.error);
    return errorResponse(fileRes.error, status);
  }
  return new Response(readFileSync(fileRes.data.absolutePath), {
    status: HTTP_OK,
    headers: {
      'Content-Type': fileRes.data.attachment.mimeType,
      'Cache-Control': 'private, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function getAttachmentErrorStatus(error: string): number {
  if (error.includes('不属于当前 Task')) return HTTP_FORBIDDEN;
  if (error.includes('不存在')) return HTTP_NOT_FOUND;
  return HTTP_BAD_REQUEST;
}
