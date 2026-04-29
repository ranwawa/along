import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock common.ts
vi.mock('../core/common', () => ({
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
  git: {
    remote: vi.fn(),
  },
}));

vi.mock('../integration/agent-config', () => ({
  resolveAgentToken: vi.fn(() => null),
}));

vi.mock('consola', () => ({
  consola: {
    withTag: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// Mock bun shell $
vi.mock('bun', () => ({
  $: Object.assign(vi.fn(), { text: vi.fn() }),
}));

import { git } from '../core/common';
import { isNotFoundError } from '../integration/github-client';

describe('github-client.ts', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isNotFoundError()', () => {
    it('status=404 返回 true', () => {
      expect(isNotFoundError({ status: 404 })).toBe(true);
    });

    it('message 包含 404 返回 true', () => {
      expect(isNotFoundError({ message: 'Error 404: Not Found' })).toBe(true);
    });

    it('message 包含 not found 返回 true（大小写不敏感）', () => {
      expect(isNotFoundError({ message: 'Resource Not Found' })).toBe(true);
    });

    it('status=200 返回 false', () => {
      expect(isNotFoundError({ status: 200, message: 'ok' })).toBe(false);
    });

    it('null/undefined 返回 false', () => {
      expect(isNotFoundError(null)).toBe(false);
      expect(isNotFoundError(undefined)).toBe(false);
    });

    it('空对象返回 false', () => {
      expect(isNotFoundError({})).toBe(false);
    });

    it('status=403 (权限拒绝) 返回 false', () => {
      expect(isNotFoundError({ status: 403 })).toBe(false);
    });
  });

  describe('readRepoInfo()', () => {
    it('解析 HTTPS 格式 remote URL', async () => {
      vi.mocked(git.remote).mockResolvedValue(
        'https://github.com/ranwawa/along.git',
      );

      // 由于有模块级缓存，需要 resetModules
      vi.resetModules();
      const mod = await import('../integration/github-client');

      const result = await mod.readRepoInfo();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ owner: 'ranwawa', repo: 'along' });
      }
    });

    it('解析 SSH 格式 remote URL', async () => {
      vi.mocked(git.remote).mockResolvedValue(
        'git@github.com:ranwawa/along.git',
      );

      vi.resetModules();
      const mod = await import('../integration/github-client');

      const result = await mod.readRepoInfo();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ owner: 'ranwawa', repo: 'along' });
      }
    });

    it('解析无 .git 后缀的 URL', async () => {
      vi.mocked(git.remote).mockResolvedValue('https://github.com/owner/repo');

      vi.resetModules();
      const mod = await import('../integration/github-client');

      const result = await mod.readRepoInfo();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ owner: 'owner', repo: 'repo' });
      }
    });

    it('无法解析时返回 failure', async () => {
      vi.mocked(git.remote).mockResolvedValue('https://gitlab.com/not-github');

      vi.resetModules();
      const mod = await import('../integration/github-client');

      const result = await mod.readRepoInfo();
      expect(result.success).toBe(false);
    });

    it('remote 为空时返回 failure', async () => {
      vi.mocked(git.remote).mockResolvedValue('');

      vi.resetModules();
      const mod = await import('../integration/github-client');

      const result = await mod.readRepoInfo();
      expect(result.success).toBe(false);
    });
  });
});
