import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import { parseRegistryConfig } from '../domain/ai-registry-config';
import { readRegistryConfig, writeRegistryConfig } from './ai-registry-store';

type UnknownRecord = Record<string, unknown>;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_ERROR = 500;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
}

function errorResponse(error: string, status = 400): Response {
  return jsonResponse({ error }, status);
}

async function readJsonObject(req: Request): Promise<Result<UnknownRecord>> {
  try {
    const parsed = await req.json();
    return isRecord(parsed)
      ? success(parsed)
      : failure('请求体必须是 JSON 对象');
  } catch {
    return failure('请求体必须是合法 JSON');
  }
}

function buildRegistryPayload(registry: unknown) {
  return registry;
}

export function isRegistryApiPath(pathname: string): boolean {
  return pathname === '/api/registry';
}

export async function handleRegistryApiRequest(
  req: Request,
): Promise<Response> {
  if (req.method === 'GET') {
    const readRes = readRegistryConfig();
    if (!readRes.success)
      return errorResponse(readRes.error, HTTP_INTERNAL_ERROR);
    return jsonResponse(buildRegistryPayload(readRes.data));
  }

  if (req.method === 'PUT') {
    const bodyRes = await readJsonObject(req);
    if (!bodyRes.success) return errorResponse(bodyRes.error, HTTP_BAD_REQUEST);

    const registryRes = parseRegistryConfig(bodyRes.data);
    if (!registryRes.success) {
      return errorResponse(registryRes.error, HTTP_BAD_REQUEST);
    }

    const writeRes = writeRegistryConfig(registryRes.data);
    if (!writeRes.success)
      return errorResponse(writeRes.error, HTTP_INTERNAL_ERROR);

    return jsonResponse(buildRegistryPayload(writeRes.data));
  }

  return errorResponse('未找到 Registry API', HTTP_NOT_FOUND);
}
