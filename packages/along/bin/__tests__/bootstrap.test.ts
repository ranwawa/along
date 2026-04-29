import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../core/config', () => ({
  config: {
    ROOT_DIR: '/mock/along',
    USER_ALONG_DIR: '/mock/home/.along',
    EDITORS: [
      {
        id: 'claude',
        name: 'Kira Code',
        detectDir: '.claude',
        mappings: [{ from: 'skills', to: '.claude/skills' }],
        runTemplate: '',
      },
    ],
    getLogTag: vi.fn(() => ({ success: true, data: 'claude' })),
    ensureDataDirs: vi.fn(),
  },
}));

vi.mock('../core/result', () => ({
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
}));

vi.mock('../core/common', () => ({
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
  ensureEditorPermissions: vi.fn(),
}));

vi.mock('../domain/worktree-init', () => ({
  syncEditorMappings: vi.fn(() => ({ success: true, data: undefined })),
}));

vi.mock('../integration/agent-config', () => ({
  getWebhookSecret: vi.fn(() => null),
}));

vi.mock('../integration/github-client', () => ({
  readRepoInfo: vi.fn(() =>
    Promise.resolve({ success: true, data: { owner: 'test', repo: 'repo' } }),
  ),
}));

vi.mock('consola', () => ({
  consola: {
    withTag: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

vi.mock('chalk', () => {
  const passthrough = (s: string) => s;
  const handler: ProxyHandler<any> = {
    get: () => new Proxy(passthrough, handler),
    apply: (_target: any, _thisArg: any, args: any[]) => args[0],
  };
  return { default: new Proxy(passthrough, handler) };
});

import fs from 'node:fs';
import { config } from '../core/config';
import {
  ensureProjectBootstrap,
  ensureWebhookSecret,
  printGitHubAppGuide,
} from '../domain/bootstrap';
import { getWebhookSecret } from '../integration/agent-config';

describe('bootstrap.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('ensureProjectBootstrap()', () => {
    it('当 .along.json 不存在时自动创建', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const result = await ensureProjectBootstrap();
      expect(result.success).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.along.json'),
        expect.stringContaining('"agent": "claude"'),
      );
    });

    it('当 .along.json 已存在时跳过创建', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const result = await ensureProjectBootstrap();
      expect(result.success).toBe(true);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('当 getLogTag 失败时返回 failure', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(config.getLogTag).mockReturnValue({
        success: false,
        error: '无法检测',
      } as any);
      const result = await ensureProjectBootstrap();
      expect(result.success).toBe(false);
    });
  });

  describe('ensureWebhookSecret()', () => {
    it('CLI flag 优先级最高', async () => {
      const result = await ensureWebhookSecret({ secret: 'cli-secret' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe('cli-secret');
    });

    it('环境变量次之', async () => {
      const original = process.env.ALONG_WEBHOOK_SECRET;
      process.env.ALONG_WEBHOOK_SECRET = 'env-secret';
      try {
        const result = await ensureWebhookSecret({});
        expect(result.success).toBe(true);
        if (result.success) expect(result.data).toBe('env-secret');
      } finally {
        if (original === undefined) delete process.env.ALONG_WEBHOOK_SECRET;
        else process.env.ALONG_WEBHOOK_SECRET = original;
      }
    });

    it('config file 第三优先级', async () => {
      const original = process.env.ALONG_WEBHOOK_SECRET;
      delete process.env.ALONG_WEBHOOK_SECRET;
      vi.mocked(getWebhookSecret).mockReturnValue('config-secret');
      try {
        const result = await ensureWebhookSecret({});
        expect(result.success).toBe(true);
        if (result.success) expect(result.data).toBe('config-secret');
      } finally {
        if (original !== undefined) process.env.ALONG_WEBHOOK_SECRET = original;
      }
    });

    it('全部未配置时返回 failure 并打印指引', async () => {
      const original = process.env.ALONG_WEBHOOK_SECRET;
      delete process.env.ALONG_WEBHOOK_SECRET;
      vi.mocked(getWebhookSecret).mockReturnValue(null);
      try {
        const result = await ensureWebhookSecret({});
        expect(result.success).toBe(false);
        expect(console.log).toHaveBeenCalled();
      } finally {
        if (original !== undefined) process.env.ALONG_WEBHOOK_SECRET = original;
      }
    });
  });

  describe('printGitHubAppGuide()', () => {
    it('调用不抛异常', async () => {
      await expect(printGitHubAppGuide()).resolves.not.toThrow();
      expect(console.log).toHaveBeenCalled();
    });
  });
});
