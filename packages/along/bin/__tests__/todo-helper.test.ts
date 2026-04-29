import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('consola', () => ({
  consola: {
    withTag: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      success: vi.fn(),
    }),
  },
}));

vi.mock('../core/common', () => ({
  iso_timestamp: () => '2026-04-11T12:00:00.000Z',
}));

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

// Inline fs mock
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

import fs from 'node:fs';
import { SessionPathManager } from '../core/session-paths';
import { completeTodoStep, saveStepOutput } from '../domain/todo-helper';

describe('todo-helper.ts', () => {
  let paths: SessionPathManager;

  beforeEach(() => {
    vi.clearAllMocks();
    paths = new SessionPathManager('ranwawa', 'along', 42);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
  });

  describe('saveStepOutput()', () => {
    it('写入文件并返回文件名', () => {
      saveStepOutput(paths, 3, 'commit', 'output content');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('step3-commit.md'),
        'output content',
        'utf-8',
      );
    });
  });

  describe('completeTodoStep()', () => {
    it('勾选指定步骤', () => {
      const todoContent = `- [ ] 第一步：理解 Issue
- [ ] 第二步：分析代码库
- [ ] 第三步：实施修复`;

      vi.mocked(fs.readFileSync).mockReturnValue(todoContent);

      completeTodoStep(paths, 1, '已完成理解');

      expect(fs.writeFileSync).toHaveBeenCalled();
      const calls = vi.mocked(fs.writeFileSync).mock.calls;
      // 应该只有一次来自 completeTodoStep 的调用
      const lastCall = calls[calls.length - 1];
      const written = lastCall[1] as string;
      expect(written).toContain('- [x]');
      expect(written).toContain('✅');
      expect(written).toContain('已完成理解');
    });

    it('带 outputFileName 时追加文件引用', () => {
      const todoContent = `- [ ] 第二步：分析代码库`;
      vi.mocked(fs.readFileSync).mockReturnValue(todoContent);

      completeTodoStep(paths, 2, '分析完成', 'step2-analyze.md');

      const calls = vi.mocked(fs.writeFileSync).mock.calls;
      const written = calls[calls.length - 1][1] as string;
      expect(written).toContain('📄');
      expect(written).toContain('step2-analyze.md');
    });

    it('todo 文件不存在时不勾选', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      completeTodoStep(paths, 1, 'test');
      // 注意：saveStepOutput 可能会被其他 it 块调用，但 clearAllMocks 保证了这里是干净的
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });
});
