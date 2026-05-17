import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegistryConfig } from '../../domain/registry/config';

const storeMocks = vi.hoisted(() => ({
  readRegistryConfig: vi.fn(),
  writeRegistryConfig: vi.fn(),
}));

vi.mock('../../adapters/config/registry-store', () => ({
  readRegistryConfig: storeMocks.readRegistryConfig,
  writeRegistryConfig: storeMocks.writeRegistryConfig,
}));

import { handleRegistryApiRequest, isRegistryApiPath } from './ai-registry-api';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;

function createRegistry(): RegistryConfig {
  return {
    providers: [{ id: 'openai', kind: 'openai-compatible' }],
    models: [
      { id: 'model', providerId: 'openai', model: 'gpt-5.2', token: 'secret' },
    ],
    runtimes: [{ id: 'codex', kind: 'codex', modelId: 'model' }],
    agents: [{ id: 'planner', runtimeId: 'codex' }],
    profiles: [],
  };
}

describe('ai-registry-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('识别 registry API 路径', () => {
    expect(isRegistryApiPath('/api/registry')).toBe(true);
    expect(isRegistryApiPath('/api/config')).toBe(false);
  });

  it('GET 返回 registry', async () => {
    storeMocks.readRegistryConfig.mockReturnValue({
      success: true,
      data: createRegistry(),
    });

    const response = await handleRegistryApiRequest(
      new Request('http://localhost/api/registry'),
    );
    const payload = (await response.json()) as RegistryConfig;

    expect(response.status).toBe(HTTP_OK);
    expect(payload.runtimes[0]?.id).toBe('codex');
  });

  it('PUT 写入 registry', async () => {
    const registry = createRegistry();
    storeMocks.writeRegistryConfig.mockReturnValue({
      success: true,
      data: registry,
    });

    const response = await handleRegistryApiRequest(
      new Request('http://localhost/api/registry', {
        method: 'PUT',
        body: JSON.stringify(registry),
      }),
    );

    expect(response.status).toBe(HTTP_OK);
    expect(storeMocks.writeRegistryConfig).toHaveBeenCalledWith(registry);
  });

  it('PUT 拒绝非法 registry', async () => {
    const response = await handleRegistryApiRequest(
      new Request('http://localhost/api/registry', {
        method: 'PUT',
        body: JSON.stringify({ providers: [] }),
      }),
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    expect(payload.error).toContain('Registry 配置无效');
  });
});
