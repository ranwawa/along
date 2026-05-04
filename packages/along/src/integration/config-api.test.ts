import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentConfigMocks = vi.hoisted(() => ({
  readGlobalConfig: vi.fn(),
  writeGlobalConfig: vi.fn(),
}));

vi.mock('../core/config', () => ({
  config: {
    CONFIG_FILE: '/mock/.along/config.json',
    EDITORS: [
      { id: 'claude', name: 'Kira Code' },
      { id: 'codex', name: 'Codex' },
    ],
  },
}));

vi.mock('./agent-config', () => ({
  readGlobalConfig: agentConfigMocks.readGlobalConfig,
  writeGlobalConfig: agentConfigMocks.writeGlobalConfig,
}));

import { handleConfigApiRequest, isConfigApiPath } from './config-api';

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('config-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentConfigMocks.readGlobalConfig.mockReturnValue({
      success: true,
      data: {
        webhookSecret: 'secret',
        taskAgents: {
          planner: { editor: 'claude' },
        },
        providers: {
          deepseek: {
            name: 'DeepSeek',
            baseUrl: 'https://api.deepseek.com',
            token: 'sk-secret-token',
            models: ['deepseek-v4-flash'],
          },
        },
      },
    });
    agentConfigMocks.writeGlobalConfig.mockImplementation((input) => ({
      success: true,
      data: input,
    }));
  });

  it('当路径属于 Config API 时，期望能识别', () => {
    expect(isConfigApiPath('/api/config')).toBe(true);
    expect(isConfigApiPath('/api/tasks')).toBe(false);
  });

  it('GET 返回 taskAgents 和可选 editor 列表', async () => {
    const response = await handleConfigApiRequest(
      new Request('http://localhost/api/config'),
    );
    const payload = (await response.json()) as {
      configPath: string;
      editors: Array<{ id: string; name: string }>;
      taskAgents: Record<string, { editor?: string }>;
      providers: Record<
        string,
        { tokenConfigured?: boolean; tokenPreview?: string; token?: string }
      >;
    };

    expect(response.status).toBe(200);
    expect(payload.configPath).toBe('/mock/.along/config.json');
    expect(payload.editors.map((editor) => editor.id)).toEqual([
      'claude',
      'codex',
    ]);
    expect(payload.taskAgents.planner.editor).toBe('claude');
    expect(payload.providers.deepseek.tokenConfigured).toBe(true);
    expect(payload.providers.deepseek.tokenPreview).toBe('sk-s...oken');
    expect(payload.providers.deepseek).not.toHaveProperty('token');
  });

  it('PUT 更新 taskAgents/providers 并保留未回显 token', async () => {
    const response = await handleConfigApiRequest(
      jsonRequest({
        taskAgents: {
          planner: { editor: 'codex', model: 'gpt-5.2' },
        },
        providers: {
          deepseek: {
            name: 'DeepSeek',
            baseUrl: 'https://api.deepseek.com',
            models: ['deepseek-v4-flash'],
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(agentConfigMocks.writeGlobalConfig).toHaveBeenCalledWith({
      webhookSecret: 'secret',
      taskAgents: {
        planner: {
          editor: 'codex',
          model: 'gpt-5.2',
          personalityVersion: undefined,
        },
      },
      providers: {
        deepseek: {
          name: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com',
          token: 'sk-secret-token',
          models: ['deepseek-v4-flash'],
        },
      },
    });
  });

  it('PUT 支持更新 provider token 和 models', async () => {
    const response = await handleConfigApiRequest(
      jsonRequest({
        taskAgents: {},
        providers: {
          deepseek: {
            name: 'DeepSeek',
            baseUrl: 'https://api.deepseek.com',
            token: 'sk-new-token',
            models: ['deepseek-v4-flash', 'deepseek-chat'],
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(agentConfigMocks.writeGlobalConfig).toHaveBeenCalledWith({
      webhookSecret: 'secret',
      taskAgents: {},
      providers: {
        deepseek: {
          name: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com',
          token: 'sk-new-token',
          models: ['deepseek-v4-flash', 'deepseek-chat'],
        },
      },
    });
  });

  it('PUT 拒绝未知 editor', async () => {
    const response = await handleConfigApiRequest(
      jsonRequest({
        taskAgents: {
          planner: { editor: 'missing' },
        },
      }),
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain('未知 editor');
  });
});
