import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../core/config', () => ({
  config: {
    ROOT_DIR: '/mock/along',
    USER_ALONG_DIR: '/mock/home/.along',
    RUNTIMES: [
      {
        id: 'codex',
        name: 'Codex',
        detectDir: '.codex',
        mappings: [{ from: 'skills', to: '.codex/skills' }],
        runTemplate: '',
      },
    ],
    getLogTag: vi.fn(() => ({ success: true, data: 'codex' })),
    ensureDataDirs: vi.fn(),
  },
}));

vi.mock('../core/result', () => ({
  success: (data: unknown) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
}));

vi.mock('../core/common', () => ({
  success: (data: unknown) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
  ensureRuntimePermissions: vi.fn(),
}));

vi.mock('./worktree-init', () => ({
  syncRuntimeMappings: vi.fn(() => ({ success: true, data: undefined })),
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
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => '{"agent":"codex"}\n'),
    rmSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

import fs from 'node:fs';
import { config } from '../core/config';
import { ensureProjectBootstrap } from './bootstrap';

describe('bootstrap.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ensureProjectBootstrap()', () => {
    it('当 .along/setting.json 不存在时自动创建', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const result = await ensureProjectBootstrap();
      expect(result.success).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.along/setting.json'),
        expect.stringContaining('"agent": "codex"'),
      );
    });

    it('当 .along/setting.json 已存在时跳过创建', async () => {
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
      });
      const result = await ensureProjectBootstrap();
      expect(result.success).toBe(false);
    });
  });
});
