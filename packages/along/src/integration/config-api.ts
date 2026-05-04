import { config } from '../core/config';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  type AlongGlobalConfig,
  type ProviderConfig,
  readGlobalConfig,
  type TaskAgentConfig,
  writeGlobalConfig,
} from './agent-config';

type UnknownRecord = Record<string, unknown>;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const DEFAULT_TASK_AGENTS: Record<string, TaskAgentConfig> = {
  '*': { editor: 'claude' },
  planner: { editor: 'claude' },
  implementer: { editor: 'claude' },
};

const DEFAULT_PROVIDERS: Record<string, ProviderConfig> = {
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-v4-flash'],
  },
};

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

function sanitizeTaskAgents(
  value: unknown,
): Result<Record<string, TaskAgentConfig>> {
  if (value === undefined) return success({});
  if (!isRecord(value)) return failure('taskAgents 必须是对象');

  const editorIds = new Set(config.EDITORS.map((editor) => editor.id));
  const result: Record<string, TaskAgentConfig> = {};

  for (const [agentId, rawConfig] of Object.entries(value)) {
    const trimmedAgentId = agentId.trim();
    if (!trimmedAgentId) return failure('agentId 不能为空');
    if (!isRecord(rawConfig)) {
      return failure(`taskAgents.${agentId} 必须是对象`);
    }

    const editor = rawConfig.editor;
    if (editor !== undefined && typeof editor !== 'string') {
      return failure(`taskAgents.${agentId}.editor 必须是字符串`);
    }
    if (editor && !editorIds.has(editor)) {
      return failure(`未知 editor: ${editor}`);
    }

    const model = rawConfig.model;
    if (model !== undefined && typeof model !== 'string') {
      return failure(`taskAgents.${agentId}.model 必须是字符串`);
    }

    const personalityVersion = rawConfig.personalityVersion;
    if (
      personalityVersion !== undefined &&
      typeof personalityVersion !== 'string'
    ) {
      return failure(`taskAgents.${agentId}.personalityVersion 必须是字符串`);
    }

    result[trimmedAgentId] = {
      editor: editor?.trim() || undefined,
      model: model?.trim() || undefined,
      personalityVersion: personalityVersion?.trim() || undefined,
    };
  }

  return success(result);
}

function sanitizeStringArray(
  value: unknown,
  fieldName: string,
): Result<string[]> {
  if (value === undefined) return success([]);
  if (!Array.isArray(value)) return failure(`${fieldName} 必须是字符串数组`);
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string')
      return failure(`${fieldName} 必须是字符串数组`);
    const trimmed = item.trim();
    if (trimmed) result.push(trimmed);
  }
  return success([...new Set(result)]);
}

function sanitizeProviders(
  value: unknown,
  existing: Record<string, ProviderConfig> = {},
): Result<Record<string, ProviderConfig>> {
  if (value === undefined) return success(existing);
  if (!isRecord(value)) return failure('providers 必须是对象');

  const result: Record<string, ProviderConfig> = {};
  for (const [providerId, rawConfig] of Object.entries(value)) {
    const trimmedProviderId = providerId.trim();
    if (!trimmedProviderId) return failure('providerId 不能为空');
    if (!isRecord(rawConfig)) {
      return failure(`providers.${providerId} 必须是对象`);
    }

    const name = rawConfig.name;
    if (name !== undefined && typeof name !== 'string') {
      return failure(`providers.${providerId}.name 必须是字符串`);
    }

    const baseUrl = rawConfig.baseUrl;
    if (baseUrl !== undefined && typeof baseUrl !== 'string') {
      return failure(`providers.${providerId}.baseUrl 必须是字符串`);
    }

    const token = rawConfig.token;
    if (token !== undefined && typeof token !== 'string') {
      return failure(`providers.${providerId}.token 必须是字符串`);
    }

    const modelsRes = sanitizeStringArray(
      rawConfig.models,
      `providers.${providerId}.models`,
    );
    if (!modelsRes.success) return modelsRes;

    result[trimmedProviderId] = {
      name: name?.trim() || undefined,
      baseUrl: baseUrl?.trim() || undefined,
      token: token?.trim() || existing[trimmedProviderId]?.token,
      models: modelsRes.data,
    };
  }

  return success(result);
}

function maskToken(token?: string) {
  if (!token) return undefined;
  if (token.length <= 8) return '********';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function sanitizeProviderPayload(providers?: Record<string, ProviderConfig>) {
  const source = providers || {};
  return Object.fromEntries(
    Object.entries(source).map(([providerId, provider]) => [
      providerId,
      {
        name: provider.name,
        baseUrl: provider.baseUrl,
        models: provider.models || [],
        tokenConfigured: Boolean(provider.token),
        tokenPreview: maskToken(provider.token),
      },
    ]),
  );
}

function buildConfigPayload(globalConfig?: AlongGlobalConfig | null) {
  return {
    configPath: config.CONFIG_FILE,
    editors: config.EDITORS.map((editor) => ({
      id: editor.id,
      name: editor.name,
    })),
    defaults: {
      taskAgents: DEFAULT_TASK_AGENTS,
      providers: sanitizeProviderPayload(DEFAULT_PROVIDERS),
    },
    taskAgents: globalConfig?.taskAgents || {},
    providers: sanitizeProviderPayload(globalConfig?.providers),
  };
}

export function isConfigApiPath(pathname: string): boolean {
  return pathname === '/api/config';
}

export async function handleConfigApiRequest(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const readRes = readGlobalConfig();
    if (!readRes.success) return errorResponse(readRes.error, 500);
    return jsonResponse(buildConfigPayload(readRes.data));
  }

  if (req.method === 'PUT') {
    const bodyRes = await readJsonObject(req);
    if (!bodyRes.success) return errorResponse(bodyRes.error, 400);

    const taskAgentsRes = sanitizeTaskAgents(bodyRes.data.taskAgents);
    if (!taskAgentsRes.success) return errorResponse(taskAgentsRes.error, 400);

    const readRes = readGlobalConfig();
    if (!readRes.success) return errorResponse(readRes.error, 500);

    const providersRes = sanitizeProviders(
      bodyRes.data.providers,
      readRes.data?.providers || {},
    );
    if (!providersRes.success) return errorResponse(providersRes.error, 400);

    const writeRes = writeGlobalConfig({
      ...(readRes.data || {}),
      taskAgents: taskAgentsRes.data,
      providers: providersRes.data,
    });
    if (!writeRes.success) return errorResponse(writeRes.error, 500);

    return jsonResponse(buildConfigPayload(writeRes.data));
  }

  return errorResponse('未找到 Config API', 404);
}
