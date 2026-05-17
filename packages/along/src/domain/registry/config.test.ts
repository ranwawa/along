import { describe, expect, it } from 'vitest';
import { parseRegistryConfig, type RegistryConfig } from './config';

function createRegistry(): RegistryConfig {
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
        id: 'gpt-main',
        providerId: 'openai',
        model: 'gpt-5.2',
        tokenEnv: 'OPENAI_API_KEY',
        maxOutputTokens: 4096,
      },
    ],
    runtimes: [
      {
        id: 'codex-openai',
        kind: 'codex',
        modelId: 'gpt-main',
      },
    ],
    agents: [
      {
        id: 'planning',
        runtimeId: 'codex-openai',
      },
      {
        id: 'exec',
        runtimeId: 'codex-openai',
      },
      {
        id: 'delivery',
        runtimeId: 'codex-openai',
      },
    ],
    profiles: [
      {
        id: 'task-title-summary',
        modelId: 'gpt-main',
        systemPrompt: 'Generate a concise task title.',
        parameters: {
          maxTokens: 80,
          outputFormat: 'text',
        },
      },
    ],
  };
}

describe('ai-registry/config', () => {
  it('接受最小合法 registry', () => {
    const result = parseRegistryConfig(createRegistry());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.providers[0]?.id).toBe('openai');
    }
  });

  it('拒绝重复 id', () => {
    const registry = createRegistry();
    registry.models.push({ ...registry.models[0] });

    const result = parseRegistryConfig(registry);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('Model id 重复');
  });

  it('拒绝未知引用', () => {
    const registry = createRegistry();
    registry.agents[0] = { id: 'planning', runtimeId: 'missing' };

    const result = parseRegistryConfig(registry);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('未知 Runtime');
  });

  it('兼容旧 registry 数组配置并把 credential 合并到 model', () => {
    const registry = createRegistry();
    registry.providers.push({ id: 'other', kind: 'openai-compatible' });

    const result = parseRegistryConfig({
      ...registry,
      credentials: [
        {
          id: 'other-token',
          providerId: 'other',
          token: 'secret',
        },
      ],
      models: [
        {
          id: 'legacy-model',
          providerId: 'openai',
          model: 'gpt-legacy',
          credentialId: 'other-token',
        },
      ],
      runtimes: [
        { id: 'codex-openai', kind: 'codex', modelId: 'legacy-model' },
      ],
      agents: [
        { id: 'planning', runtimeId: 'codex-openai' },
        { id: 'exec', runtimeId: 'codex-openai' },
        { id: 'delivery', runtimeId: 'codex-openai' },
      ],
      profiles: [
        {
          id: 'task-title-summary',
          modelId: 'legacy-model',
          systemPrompt: 'Generate a concise task title.',
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.models[0]).toMatchObject({
        id: 'legacy-model',
        token: 'secret',
      });
      expect('credentials' in result.data).toBe(false);
    }
  });

  it('拒绝缺失必需集合', () => {
    const result = parseRegistryConfig({
      providers: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('Registry 配置无效');
  });

  it('兼容旧 providers/taskAgents 对象配置', () => {
    const result = parseRegistryConfig({
      taskAgents: {
        '*': { editor: 'claude' },
        planner: { editor: 'codex', model: 'gpt-5.5' },
        implementer: { editor: 'codex', model: 'gpt-5.5' },
        delivery: { editor: 'codex', model: 'gpt-5.5' },
      },
      providers: {
        deepseek: {
          name: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com/v1',
          token: 'secret',
          models: ['deepseek-v4-flash'],
        },
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.providers[0]).toMatchObject({
        id: 'deepseek',
      });
      expect(result.data.models[0]).toMatchObject({
        providerId: 'deepseek',
        token: 'secret',
      });
      expect(result.data.runtimes).toEqual([{ id: 'codex', kind: 'codex' }]);
      expect(result.data.agents).toEqual([
        { id: 'planning', runtimeId: 'codex', modelId: 'gpt-5.5' },
        { id: 'exec', runtimeId: 'codex', modelId: 'gpt-5.5' },
        { id: 'delivery', runtimeId: 'codex', modelId: 'gpt-5.5' },
      ]);
      expect(
        result.data.models.find((model) => model.id === 'gpt-5.5'),
      ).toMatchObject({
        token: 'secret',
      });
    }
  });

  it('拒绝 profile maxTokens 超过模型上限', () => {
    const registry = createRegistry();
    registry.profiles[0] = {
      ...registry.profiles[0],
      parameters: { maxTokens: 5000 },
    };

    const result = parseRegistryConfig(registry);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('maxTokens');
  });
});
