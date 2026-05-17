import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegistryConfig } from '../../domain/registry/config';

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: fsMock,
}));

vi.mock('../../core/config', () => ({
  config: {
    CONFIG_FILE: '/mock/.along/config.json',
    ensureDataDirs: vi.fn(),
  },
}));

import {
  clearRegistryConfigCache,
  readRegistryConfig,
  writeRegistryConfig,
} from './registry-store';

function createRegistry(): RegistryConfig {
  return {
    providers: [{ id: 'openai', kind: 'openai-compatible' }],
    models: [
      { id: 'model', providerId: 'openai', model: 'gpt-5.2', token: 'secret' },
    ],
    runtimes: [{ id: 'codex', kind: 'codex', modelId: 'model' }],
    agents: [
      { id: 'planning', runtimeId: 'codex' },
      { id: 'exec', runtimeId: 'codex' },
      { id: 'delivery', runtimeId: 'codex' },
    ],
    profiles: [{ id: 'title', modelId: 'model', systemPrompt: 'title' }],
  };
}

describe('ai-registry-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegistryConfigCache();
  });

  it('配置文件不存在时返回错误', () => {
    fsMock.existsSync.mockReturnValue(false);

    const result = readRegistryConfig();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('配置文件不存在');
  });

  it('读取合法 registry', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify(createRegistry()));

    const result = readRegistryConfig();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.agents[0]?.id).toBe('planning');
  });

  it('读取旧版 registry 配置时迁移为数组结构', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({
        taskAgents: {
          planner: { editor: 'codex', model: 'gpt-5.5' },
          implementer: { editor: 'codex', model: 'gpt-5.5' },
          delivery: { editor: 'codex', model: 'gpt-5.5' },
        },
        providers: {
          deepseek: {
            baseUrl: 'https://api.deepseek.com/v1',
            token: 'secret',
            models: ['deepseek-v4-flash'],
          },
        },
      }),
    );

    const result = readRegistryConfig();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.providers[0]?.id).toBe('deepseek');
      expect(result.data.agents[0]).toEqual({
        id: 'planning',
        runtimeId: 'codex',
        modelId: 'gpt-5.5',
      });
    }
  });

  it('非法 JSON 返回错误', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue('{oops');

    const result = readRegistryConfig();

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error).toContain('读取 Registry 配置失败');
  });

  it('写入前校验 registry 并格式化 JSON', () => {
    const registry = createRegistry();

    const result = writeRegistryConfig(registry);

    expect(result.success).toBe(true);
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(
      '/mock/.along/config.json',
      expect.stringContaining('"providers"'),
    );
  });
});
