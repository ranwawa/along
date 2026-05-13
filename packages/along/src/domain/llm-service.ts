import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import { readRegistryConfig } from '../integration/ai-registry-store';
import {
  type ResolvedProfileLlmConfig,
  resolveProfileLlmConfig,
} from './ai-registry-resolver';

export interface RunProfileInput {
  profileId: string;
  variables?: Record<string, string>;
}

export interface RunProfileOutput {
  text?: string;
  json?: unknown;
  raw: unknown;
}

export interface LlmServiceDependencies {
  readRegistry?: typeof readRegistryConfig;
  fetch?: typeof fetch;
}

function renderTemplate(
  template: string | undefined,
  variables: Record<string, string> | undefined,
): string {
  if (!template || !variables) return template || '';
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) =>
    Object.hasOwn(variables, key) ? variables[key] || '' : match,
  );
}

function buildOpenAiCompatibleRequest(config: ResolvedProfileLlmConfig) {
  const userContent = renderTemplate(config.userTemplate, undefined);
  const messages = [
    { role: 'system', content: config.systemPrompt },
    ...(userContent ? [{ role: 'user', content: userContent }] : []),
  ];
  return {
    model: config.model,
    messages,
    temperature: config.parameters.temperature,
    max_tokens: config.parameters.maxTokens,
    response_format:
      config.parameters.outputFormat === 'json'
        ? { type: 'json_object' }
        : undefined,
  };
}

function extractText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return undefined;
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  return typeof first?.message?.content === 'string'
    ? first.message.content
    : undefined;
}

async function runOpenAiCompatible(
  config: ResolvedProfileLlmConfig,
  fetchImpl: typeof fetch,
): Promise<Result<RunProfileOutput>> {
  if (!config.baseUrl) {
    return failure(`Provider ${config.providerId} 缺少 baseUrl`);
  }
  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify(buildOpenAiCompatibleRequest(config)),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) return failure(`LLM 请求失败: ${response.status}`);

  const text = extractText(payload);
  if (config.parameters.outputFormat === 'json') {
    if (!text) return failure('LLM JSON 输出为空');
    try {
      return success({ json: JSON.parse(text), raw: payload });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return failure(`解析 LLM JSON 输出失败: ${message}`);
    }
  }

  return success({ text: text || '', raw: payload });
}

export async function runProfile(
  input: RunProfileInput,
  dependencies: LlmServiceDependencies = {},
): Promise<Result<RunProfileOutput>> {
  const readRegistry = dependencies.readRegistry || readRegistryConfig;
  const registryRes = readRegistry();
  if (!registryRes.success) return registryRes;

  const configRes = resolveProfileLlmConfig({
    registry: registryRes.data,
    profileId: input.profileId,
  });
  if (!configRes.success) return configRes;

  const config = {
    ...configRes.data,
    userTemplate: renderTemplate(configRes.data.userTemplate, input.variables),
  };

  if (config.providerKind !== 'openai-compatible') {
    return failure(`暂不支持 Provider kind: ${config.providerKind}`);
  }

  return runOpenAiCompatible(config, dependencies.fetch || fetch);
}

export const LLMService = {
  runProfile,
};
