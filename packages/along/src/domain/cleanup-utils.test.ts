import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionMocks = vi.hoisted(() => ({
  logEvent: vi.fn(),
}));

vi.mock('../core/common', () => ({
  success: (data: unknown) => ({ success: true, data }),
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

vi.mock('./worktree-init', () => ({
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

vi.mock('./session-manager', () => ({
  SessionManager: vi.fn(() => ({
    logEvent: sessionMocks.logEvent,
  })),
}));

vi.mock('../core/db', () => ({
  readSession: vi.fn(() => ({ success: true, data: null })),
  upsertSession: vi.fn(() => ({ success: true })),
  transactSession: vi.fn(),
}));

vi.mock('./session-state-machine', () => ({
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

import { $ } from 'bun';
import { getGit, git } from '../core/common';
import { cleanupIssue, pullDefaultBranch } from './cleanup-utils';
import { getDefaultBranch } from './worktree-init';

describe('cleanup-utils.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked($).mockImplementation(
      () =>
        ({
          cwd: vi.fn().mockReturnThis(),
          text: vi.fn().mockResolvedValue(''),
          quiet: vi.fn().mockReturnThis(),
          nothrow: vi.fn().mockResolvedValue(undefined),
        }) as unknown as ReturnType<typeof $>,
    );
    vi.mocked(getGit).mockReturnValue({
      fetch: vi.fn(),
      raw: vi.fn(),
    } as unknown as ReturnType<typeof getGit>);
  });

  describe('pullDefaultBranch()', () => {
    it('正常更新本地默认分支', async () => {
      vi.mocked(getDefaultBranch).mockResolvedValue({
        success: true,
        data: 'master',
      });
      vi.mocked(git.fetch).mockResolvedValue(undefined);
      vi.mocked(git.raw).mockResolvedValueOnce('').mockResolvedValueOnce('');

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
      vi.mocked(getGit).mockReturnValue(
        mockGitInstance as unknown as ReturnType<typeof getGit>,
      );
      vi.mocked(getDefaultBranch).mockResolvedValue({
        success: true,
        data: 'main',
      });
      mockGitInstance.fetch.mockResolvedValue(undefined);
      mockGitInstance.raw.mockResolvedValueOnce('').mockResolvedValueOnce('');

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

    it('当前在默认分支上时使用 ff-only 更新当前分支', async () => {
      vi.mocked(getDefaultBranch).mockResolvedValue({
        success: true,
        data: 'master',
      });
      vi.mocked(git.fetch).mockResolvedValue(undefined);
      vi.mocked(git.raw).mockRejectedValue(
        new Error('cannot force update the current branch'),
      );
      vi.mocked(git.raw)
        .mockResolvedValueOnce('master\n')
        .mockResolvedValueOnce('');

      const result = await pullDefaultBranch();

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe('master');
      expect(git.raw).toHaveBeenCalledWith([
        'merge',
        '--ff-only',
        'origin/master',
      ]);
    });

    it('branch -f 失败时返回 failure，不误报本地默认分支已同步', async () => {
      vi.mocked(getDefaultBranch).mockResolvedValue({
        success: true,
        data: 'master',
      });
      vi.mocked(git.fetch).mockResolvedValue(undefined);
      vi.mocked(git.raw)
        .mockResolvedValueOnce('feature/demo\n')
        .mockRejectedValueOnce(new Error('checked out in another worktree'));

      const result = await pullDefaultBranch();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('更新本地默认分支失败');
      }
    });

    it('清理成功但默认分支同步失败时记录事件且不阻断清理', async () => {
      vi.mocked(getDefaultBranch).mockResolvedValue({
        success: true,
        data: 'master',
      });
      const mockGitInstance = { fetch: vi.fn(), raw: vi.fn() };
      vi.mocked(getGit).mockReturnValue(
        mockGitInstance as unknown as ReturnType<typeof getGit>,
      );
      mockGitInstance.fetch.mockRejectedValue(new Error('network error'));

      const result = await cleanupIssue(
        '42',
        {
          worktreePath: '/mock/worktree',
          branchName: 'feat/demo',
          silent: true,
        },
        'ranwawa',
        'along',
        '/repo/along',
      );

      expect(result.success).toBe(true);
      expect(sessionMocks.logEvent).toHaveBeenCalledWith(
        'default-branch-sync-failed',
        expect.objectContaining({
          error: expect.stringContaining('fetch 失败'),
        }),
      );
    });
  });
});
