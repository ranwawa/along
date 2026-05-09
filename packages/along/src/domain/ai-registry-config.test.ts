import { describe, expect, it } from 'vitest';
import { parseRegistryConfig, type RegistryConfig } from './ai-registry-config';

function createRegistry(): RegistryConfig {
  return {
    providers: [
      {
        id: 'openai',
        kind: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        defaultCredentialId: 'openai-main',
      },
    ],
    credentials: [
      {
        id: 'openai-main',
        providerId: 'openai',
        tokenEnv: 'OPENAI_API_KEY',
      },
    ],
    models: [
      {
        id: 'gpt-main',
        providerId: 'openai',
        model: 'gpt-5.2',
        credentialId: 'openai-main',
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
        id: 'planner',
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

describe('ai-registry-config', () => {
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
    registry.agents[0] = { id: 'planner', runtimeId: 'missing' };

    const result = parseRegistryConfig(registry);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('未知 Runtime');
  });

  it('拒绝 model/credential provider mismatch', () => {
    const registry = createRegistry();
    registry.providers.push({ id: 'other', kind: 'openai-compatible' });
    registry.credentials.push({
      id: 'other-token',
      providerId: 'other',
      token: 'secret',
    });
    registry.models[0] = {
      ...registry.models[0],
      credentialId: 'other-token',
    };

    const result = parseRegistryConfig(registry);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('不属于 Provider');
  });

  it('拒绝缺失必需集合', () => {
    const result = parseRegistryConfig({
      providers: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('Registry 配置无效');
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
