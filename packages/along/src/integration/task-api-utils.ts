import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import type { TaskAttachmentUploadInput } from '../domain/task-attachments';
import {
  TASK_AGENT_STAGE,
  TASK_EXECUTION_MODE,
  TASK_RUNTIME_EXECUTION_MODE,
  TASK_WORKSPACE_MODE,
  type TaskAgentStage,
  type TaskExecutionMode,
  type TaskRuntimeExecutionMode,
  type TaskWorkspaceMode,
} from '../domain/task-planning';
import { HTTP_BAD_REQUEST, HTTP_OK } from './http-status';

export type UnknownRecord = Record<string, unknown>;

export interface ParsedTaskRequest {
  payload: UnknownRecord;
  attachments: TaskAttachmentUploadInput[];
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function jsonResponse(payload: unknown, status = HTTP_OK): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
}

export function errorResponse(
  error: string,
  status = HTTP_BAD_REQUEST,
): Response {
  return jsonResponse({ error }, status);
}

export async function readJsonObject(
  req: Request,
): Promise<Result<UnknownRecord>> {
  try {
    const parsed = await req.json();
    return isRecord(parsed)
      ? success(parsed)
      : failure('请求体必须是 JSON 对象');
  } catch {
    return failure('请求体必须是合法 JSON');
  }
}

export function readStringField(
  payload: UnknownRecord,
  key: string,
): string | undefined {
  const value = payload[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function readBooleanField(
  payload: UnknownRecord,
  key: string,
): boolean | undefined {
  const value = payload[key];
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export async function readTaskRequestPayload(
  req: Request,
): Promise<Result<ParsedTaskRequest>> {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.toLowerCase().startsWith('multipart/form-data')) {
    return readMultipartTaskRequest(req);
  }
  const jsonRes = await readJsonObject(req);
  if (!jsonRes.success) return failure(jsonRes.error);
  return success({ payload: jsonRes.data, attachments: [] });
}

export async function readMultipartTaskRequest(
  req: Request,
): Promise<Result<ParsedTaskRequest>> {
  try {
    const form = await req.formData();
    const payload: UnknownRecord = {};
    const attachments: TaskAttachmentUploadInput[] = [];
    for (const [key, value] of form.entries()) {
      if (key === 'attachments') {
        if (value instanceof File) {
          attachments.push({
            originalName: value.name,
            mimeType: value.type,
            bytes: new Uint8Array(await value.arrayBuffer()),
          });
        }
        continue;
      }
      if (typeof value === 'string') payload[key] = value;
    }
    return success({ payload, attachments });
  } catch {
    return failure('请求体必须是合法 multipart/form-data');
  }
}

export function readTaskExecutionModeField(
  payload: UnknownRecord,
  key: string,
): Result<TaskExecutionMode | undefined> {
  const rawValue = payload[key];
  const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
  if (value === undefined || value === null || value === '') {
    return success(undefined);
  }
  if (
    value === TASK_EXECUTION_MODE.MANUAL ||
    value === TASK_EXECUTION_MODE.AUTONOMOUS
  ) {
    return success(value);
  }
  return failure('executionMode 必须是 manual 或 autonomous');
}

export function readTaskRuntimeExecutionModeField(
  payload: UnknownRecord,
  key: string,
): Result<TaskRuntimeExecutionMode | undefined> {
  const rawValue = payload[key];
  const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
  if (value === undefined || value === null || value === '') {
    return success(undefined);
  }
  if (
    value === TASK_RUNTIME_EXECUTION_MODE.AUTO ||
    value === TASK_RUNTIME_EXECUTION_MODE.CHAT ||
    value === TASK_RUNTIME_EXECUTION_MODE.PLAN ||
    value === TASK_RUNTIME_EXECUTION_MODE.EXEC
  ) {
    return success(value);
  }
  return failure('runtimeExecutionMode 必须是 auto、chat、plan 或 exec');
}

export function readTaskWorkspaceModeField(
  payload: UnknownRecord,
  key: string,
): Result<TaskWorkspaceMode | undefined> {
  const rawValue = payload[key];
  const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
  if (value === undefined || value === null || value === '') {
    return success(undefined);
  }
  if (
    value === TASK_WORKSPACE_MODE.WORKTREE ||
    value === TASK_WORKSPACE_MODE.DEFAULT_BRANCH
  ) {
    return success(value);
  }
  return failure('workspaceMode 必须是 worktree 或 default_branch');
}

export function readTaskAgentStageField(
  payload: UnknownRecord,
  key: string,
): TaskAgentStage | undefined {
  const value = readStringField(payload, key);
  if (
    value === TASK_AGENT_STAGE.PLANNING ||
    value === TASK_AGENT_STAGE.EXEC ||
    value === TASK_AGENT_STAGE.DELIVERY
  ) {
    return value;
  }
  return undefined;
}

export function readOptionalPositiveIntField(
  payload: UnknownRecord,
  key: string,
): number | undefined {
  const value = payload[key];
  if (typeof value !== 'number') return undefined;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

export function readPositiveInt(
  value: string | null,
  fallback: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
