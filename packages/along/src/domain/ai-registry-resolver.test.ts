import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RegistryConfig } from './ai-registry-config';
import {
  resolveAgentRuntimeConfig,
  resolveProfileLlmConfig,
} from './ai-registry-resolver';

function createRegistry(): RegistryConfig {
  return {
    providers: [
      {
        id: 'openai',
        kind: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        defaultCredentialId: 'provider-token',
      },
    ],
    credentials: [
      { id: 'provider-token', providerId: 'openai', token: 'provider-secret' },
      { id: 'model-token', providerId: 'openai', token: 'model-secret' },
      { id: 'runtime-token', providerId: 'openai', token: 'runtime-secret' },
      { id: 'agent-token', providerId: 'openai', token: 'agent-secret' },
      { id: 'override-token', providerId: 'openai', token: 'override-secret' },
      { id: 'env-token', providerId: 'openai', tokenEnv: 'OPENAI_TEST_KEY' },
    ],
    models: [
      {
        id: 'model-default',
        providerId: 'openai',
        model: 'gpt-default',
        credentialId: 'model-token',
      },
      {
        id: 'model-agent',
        providerId: 'openai',
        model: 'gpt-agent',
      },
      {
        id: 'model-override',
        providerId: 'openai',
        model: 'gpt-override',
      },
    ],
    runtimes: [
      {
        id: 'codex',
        kind: 'codex',
        modelId: 'model-default',
        credentialId: 'runtime-token',
      },
    ],
    agents: [
      {
        id: 'planner',
        runtimeId: 'codex',
        modelId: 'model-agent',
        credentialId: 'agent-token',
        personalityVersion: 'v1',
      },
    ],
    profiles: [
      {
        id: 'title',
        modelId: 'model-default',
        credentialId: 'env-token',
        systemPrompt: 'title',
        parameters: { temperature: 0.2 },
      },
    ],
  };
}

describe('ai-registry-resolver', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, OPENAI_TEST_KEY: 'env-secret' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('解析 Agent runtime，使用 task override > agent > runtime 的模型优先级', () => {
    const result = resolveAgentRuntimeConfig({
      registry: createRegistry(),
      agentId: 'planner',
      modelId: 'model-override',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.modelId).toBe('model-override');
      expect(result.data.model).toBe('gpt-override');
      expect(result.data.personalityVersion).toBe('v1');
    }
  });

  it('解析 Agent credential，使用 task override > agent > runtime > model > provider default', () => {
    const result = resolveAgentRuntimeConfig({
      registry: createRegistry(),
      agentId: 'planner',
      credentialId: 'override-token',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.credentialId).toBe('override-token');
      expect(result.data.token).toBe('override-secret');
    }
  });

  it('解析 Profile LLM config', () => {
    const result = resolveProfileLlmConfig({
      registry: createRegistry(),
      profileId: 'title',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.providerId).toBe('openai');
      expect(result.data.model).toBe('gpt-default');
      expect(result.data.token).toBe('env-secret');
      expect(result.data.parameters).toEqual({
        temperature: 0.2,
        outputFormat: 'text',
      });
    }
  });

  it('tokenEnv 缺失时解析失败', () => {
    delete process.env.OPENAI_TEST_KEY;

    const result = resolveProfileLlmConfig({
      registry: createRegistry(),
      profileId: 'title',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('OPENAI_TEST_KEY');
  });
});
