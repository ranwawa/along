import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../core/config', () => ({
  config: {
    USER_ALONG_DIR: '/mock/.along',
    getIssueDir: (owner: string, repo: string, issueNumber: number) =>
      `/mock/.along/${owner}/${repo}/${issueNumber}`,
  },
}));

vi.mock('../core/result', () => ({
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
}));

vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    existsSync: vi.fn(),
  },
}));

import fs from 'fs';
import { getSessionPaths, SessionPathManager } from '../core/session-paths';

describe('session-paths.ts', () => {
  const owner = 'ranwawa';
  const repo = 'along';
  const issueNumber = 42;
  let pm: SessionPathManager;

  beforeEach(() => {
    vi.restoreAllMocks();
    pm = new SessionPathManager(owner, repo, issueNumber);
  });

  describe('getIssueDir()', () => {
    it('返回正确的 issue 目录路径', () => {
      expect(pm.getIssueDir()).toBe('/mock/.along/ranwawa/along/42');
    });
  });

  describe('文件路径方法', () => {
    const issueDir = '/mock/.along/ranwawa/along/42';

    it('getTodoFile() 返回 todo.md', () => {
      expect(pm.getTodoFile()).toBe(path.join(issueDir, 'todo.md'));
    });

    it('getIssueFile() 返回 issue.json', () => {
      expect(pm.getIssueFile()).toBe(path.join(issueDir, 'issue.json'));
    });

    it('getStepOutputFile() 返回 step{N}-{name}.md', () => {
      expect(pm.getStepOutputFile(3, 'commit')).toBe(
        path.join(issueDir, 'step3-commit.md'),
      );
    });

    it('getPrCommentsFile() 返回 pr-comments.json', () => {
      expect(pm.getPrCommentsFile()).toBe(
        path.join(issueDir, 'pr-comments.json'),
      );
    });

    it('getCiFailuresFile() 返回 ci-failures.json', () => {
      expect(pm.getCiFailuresFile()).toBe(
        path.join(issueDir, 'ci-failures.json'),
      );
    });

    it('getLogFile() 返回 system.log', () => {
      expect(pm.getLogFile()).toBe(path.join(issueDir, 'system.log'));
    });

    it('getAgentLogFile() 返回 agent.log', () => {
      expect(pm.getAgentLogFile()).toBe(path.join(issueDir, 'agent.log'));
    });

    it('getDiagnosticFile() 返回 diagnostic.json', () => {
      expect(pm.getDiagnosticFile()).toBe(
        path.join(issueDir, 'diagnostic.json'),
      );
    });

    it('getWorktreeDir() 返回 worktree 目录', () => {
      expect(pm.getWorktreeDir()).toBe(path.join(issueDir, 'worktree'));
    });

    it('getAgentDataExportDir() 返回 agent-data', () => {
      expect(pm.getAgentDataExportDir()).toBe(
        path.join(issueDir, 'agent-data'),
      );
    });
  });

  describe('ensureDir()', () => {
    it('成功创建目录时返回 success', () => {
      (fs.mkdirSync as any).mockReturnValue(undefined);
      const result = pm.ensureDir();
      expect(result.success).toBe(true);
      expect(fs.mkdirSync).toHaveBeenCalledWith(pm.getIssueDir(), {
        recursive: true,
      });
    });

    it('创建失败时返回 failure', () => {
      (fs.mkdirSync as any).mockImplementation(() => {
        throw new Error('EACCES');
      });
      const result = pm.ensureDir();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('EACCES');
      }
    });
  });

  describe('getter 方法', () => {
    it('getOwner() 返回 owner', () => {
      expect(pm.getOwner()).toBe('ranwawa');
    });

    it('getRepo() 返回 repo', () => {
      expect(pm.getRepo()).toBe('along');
    });

    it('getIssueNumber() 返回 issueNumber', () => {
      expect(pm.getIssueNumber()).toBe(42);
    });
  });

  describe('getSessionPaths()', () => {
    it('便捷函数返回 SessionPathManager 实例', () => {
      const paths = getSessionPaths('a', 'b', 1);
      expect(paths).toBeInstanceOf(SessionPathManager);
      expect(paths.getOwner()).toBe('a');
    });
  });
});
