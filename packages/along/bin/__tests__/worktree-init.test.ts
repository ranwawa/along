import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../core/common', () => ({
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
  git: {
    raw: vi.fn(),
    fetch: vi.fn(),
  },
}));

vi.mock('../core/config', () => ({
  config: {
    ROOT_DIR: '/mock/along',
    EDITORS: [
      {
        id: 'opencode',
        name: 'OpenCode',
        detectDir: '.opencode',
        mappings: [{ from: 'skills', to: '.opencode/skills' }],
      },
    ],
    getLogTag: vi.fn(() => ({ success: true, data: 'opencode' })),
  },
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
    renameSync: vi.fn(),
    rmSync: vi.fn(),
    symlinkSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

vi.mock('../core/db', () => ({
  upsertSession: vi.fn(() => ({ success: true })),
}));

import fs from 'fs';
import { git } from '../core/common';
// Now that we fixed the source code syntax, we can import it properly!
import {
  getDefaultBranch,
  setupWorktree,
  syncEditorMappings,
} from '../domain/worktree-init';

describe('worktree-init.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('getDefaultBranch()', () => {
    it('解析成功', async () => {
      vi.mocked(git.raw).mockResolvedValue('HEAD branch: main\n');
      const result = await getDefaultBranch();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe('main');
    });
  });

  describe('setupWorktree()', () => {
    it('目录已存在且有标记时返回成功', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const result = await setupWorktree('/mock/path');
      expect(result.success).toBe(true);
    });
  });

  describe('syncEditorMappings()', () => {
    it('按映射创建目录软链', () => {
      vi.mocked(fs.existsSync).mockImplementation(
        (target: any) => target === '/mock/along/skills',
      );

      const result = syncEditorMappings('/mock/worktree', {
        id: 'opencode',
        name: 'OpenCode',
        detectDir: '.opencode',
        mappings: [{ from: 'skills', to: '.opencode/skills' }],
        runTemplate: '',
      });

      expect(result.success).toBe(true);
      expect(fs.mkdirSync).toHaveBeenCalledWith('/mock/worktree/.opencode', {
        recursive: true,
      });
      expect(fs.symlinkSync).toHaveBeenCalledWith(
        path.relative('/mock/worktree/.opencode', '/mock/along/skills'),
        '/mock/worktree/.opencode/skills',
        'dir',
      );
    });
  });
});
