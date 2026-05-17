import { describe, expect, it, vi } from 'vitest';
import type { RegistryConfig } from '../../domain/registry/config';
import { LLMService } from './llm-service';

function createRegistry(
  outputFormat: 'text' | 'json' = 'text',
): RegistryConfig {
  return {
    providers: [
      {
        id: 'openai',
        kind: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
      },
    ],
    models: [
      {
        id: 'model',
        providerId: 'openai',
        model: 'gpt-5.2',
        token: 'secret',
      },
    ],
    runtimes: [],
    agents: [],
    profiles: [
      {
        id: 'title',
        modelId: 'model',
        systemPrompt: 'Generate a title.',
        userTemplate: 'Body: {{body}}',
        parameters: {
          temperature: 0.2,
          maxTokens: 80,
          outputFormat,
        },
      },
    ],
  };
}

function createFetchMock(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  });
}

describe('llm-service', () => {
  it('构造 openai-compatible profile 请求', async () => {
    const fetchMock = createFetchMock('A title');

    const result = await LLMService.runProfile(
      {
        profileId: 'title',
        variables: { body: 'hello' },
      },
      {
        readRegistry: () => ({ success: true, data: createRegistry() }),
        fetch: fetchMock as unknown as typeof fetch,
      },
    );

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret',
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body).toEqual(
      expect.objectContaining({
        model: 'gpt-5.2',
        temperature: 0.2,
        max_tokens: 80,
      }),
    );
    expect(body.messages[1].content).toBe('Body: hello');
  });

  it('JSON outputFormat 解析失败时返回错误', async () => {
    const fetchMock = createFetchMock('not-json');

    const result = await LLMService.runProfile(
      { profileId: 'title' },
      {
        readRegistry: () => ({ success: true, data: createRegistry('json') }),
        fetch: fetchMock as unknown as typeof fetch,
      },
    );

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error).toContain('解析 LLM JSON 输出失败');
  });
});
