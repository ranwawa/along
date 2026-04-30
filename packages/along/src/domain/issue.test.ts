import { describe, expect, it, vi } from 'vitest';

vi.mock('../core/common', () => ({
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
}));

vi.mock('../integration/github-client', () => ({
  get_gh_client: vi.fn(),
}));

import { Issue } from './issue';

describe('issue.ts', () => {
  describe('checkHealth()', () => {
    it('data 未加载时返回 failure', () => {
      const issue = new Issue(42, {});
      const result = issue.checkHealth();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('尚未加载');
      }
    });

    it('issue 已关闭时返回 failure', () => {
      const issue = new Issue(42, {});
      issue.data = { state: 'closed', labels: [] } as any;
      const result = issue.checkHealth();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('closed');
      }
    });

    it('open 且无 running 标签时返回 success', () => {
      const issue = new Issue(42, {});
      issue.data = { state: 'open', labels: [{ name: 'bug' }] } as any;
      const result = issue.checkHealth();
      expect(result.success).toBe(true);
    });

    it('有 running 标签时返回 failure', () => {
      const issue = new Issue(42, {});
      issue.data = { state: 'open', labels: [{ name: 'running' }] } as any;
      const result = issue.checkHealth();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('running');
      }
    });

    it('skipWipCheck=true 时跳过 running 检查', () => {
      const issue = new Issue(42, {});
      issue.data = { state: 'open', labels: [{ name: 'running' }] } as any;
      const result = issue.checkHealth({ skipWipCheck: true });
      expect(result.success).toBe(true);
    });

    it('标签为纯字符串格式时也能正确检测 running', () => {
      const issue = new Issue(42, {});
      issue.data = { state: 'open', labels: ['running'] } as any;
      const result = issue.checkHealth();
      expect(result.success).toBe(false);
    });
  });
});
