import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../core/common', () => ({
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
  git: {
    fetch: vi.fn(),
    raw: vi.fn(),
  },
  getGit: vi.fn(() => ({
    fetch: vi.fn(),
    raw: vi.fn(),
  })),
  check_process_running: vi.fn(),
}));

vi.mock('consola', () => ({
  consola: {
    withTag: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock('../domain/worktree-init', () => ({
  getDefaultBranch: vi.fn(),
}));

vi.mock('../integration/github-client', () => ({
  readRepoInfo: vi.fn(),
}));

vi.mock('../core/config', () => ({
  config: {
    USER_ALONG_DIR: '/mock/.along',
    getLogTag: vi.fn(() => ({ success: true, data: 'along' })),
  },
}));

vi.mock('../logging/log-writer', () => ({
  logWriter: {
    writeSession: vi.fn(),
    writeGlobal: vi.fn(),
    flush: vi.fn(),
  },
}));

vi.mock('../core/session-paths', () => ({
  SessionPathManager: vi.fn(() => ({
    getWorktreeDir: vi.fn(() => '/mock/worktree'),
    getIssueDir: vi.fn(() => '/mock/issue'),
  })),
}));

vi.mock('../domain/session-manager', () => ({
  SessionManager: vi.fn(() => ({
    logEvent: vi.fn(),
  })),
}));

vi.mock('../core/db', () => ({
  readSession: vi.fn(() => ({ success: true, data: null })),
  upsertSession: vi.fn(() => ({ success: true })),
  transactSession: vi.fn(),
}));

vi.mock('../domain/session-state-machine', () => ({
  isActiveSessionStatus: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    rmSync: vi.fn(),
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn(() => ({
      write: vi.fn(),
      end: vi.fn(),
      destroyed: false,
    })),
  },
}));

vi.mock('bun', () => ({
  $: vi.fn(),
}));

import { getGit, git } from '../core/common';
import { pullDefaultBranch } from '../domain/cleanup-utils';
import { getDefaultBranch } from '../domain/worktree-init';

describe('cleanup-utils.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('pullDefaultBranch()', () => {
    it('正常更新本地默认分支', async () => {
      vi.mocked(getDefaultBranch).mockResolvedValue({
        success: true,
        data: 'master',
      });
      vi.mocked(git.fetch).mockResolvedValue(undefined as any);
      vi.mocked(git.raw).mockResolvedValue('');

      const result = await pullDefaultBranch();

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe('master');
      expect(git.fetch).toHaveBeenCalledWith('origin', 'master');
      expect(git.raw).toHaveBeenCalledWith([
        'branch',
        '-f',
        'master',
        'origin/master',
      ]);
    });

    it('使用自定义 repoPath 时调用 getGit', async () => {
      const mockGitInstance = { fetch: vi.fn(), raw: vi.fn() };
      vi.mocked(getGit).mockReturnValue(mockGitInstance as any);
      vi.mocked(getDefaultBranch).mockResolvedValue({
        success: true,
        data: 'main',
      });
      mockGitInstance.fetch.mockResolvedValue(undefined);
      mockGitInstance.raw.mockResolvedValue('');

      const result = await pullDefaultBranch('/custom/repo');

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe('main');
      expect(getGit).toHaveBeenCalledWith('/custom/repo');
    });

    it('获取默认分支失败时返回 failure', async () => {
      vi.mocked(getDefaultBranch).mockResolvedValue({
        success: false,
        error: 'remote 不可达',
      });

      const result = await pullDefaultBranch();

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('remote 不可达');
      expect(git.fetch).not.toHaveBeenCalled();
    });

    it('fetch 失败时返回 failure', async () => {
      vi.mocked(getDefaultBranch).mockResolvedValue({
        success: true,
        data: 'master',
      });
      vi.mocked(git.fetch).mockRejectedValue(new Error('network error'));

      const result = await pullDefaultBranch();

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('fetch 失败');
    });

    it('当前在默认分支上时 branch -f 失败，降级为仅 fetch 成功', async () => {
      vi.mocked(getDefaultBranch).mockResolvedValue({
        success: true,
        data: 'master',
      });
      vi.mocked(git.fetch).mockResolvedValue(undefined as any);
      vi.mocked(git.raw).mockRejectedValue(
        new Error('cannot force update the current branch'),
      );

      const result = await pullDefaultBranch();

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe('master');
    });
  });
});
