import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '../../core/result';

const LONG_ERROR_LENGTH = 10_000;
const MAX_FAILURE_SUMMARY_LENGTH = 6000;

const planningMocks = vi.hoisted(() => ({
  recordTaskAgentResult: vi.fn(),
  transitionTaskWorkflow: vi.fn(),
  updateTaskDelivery: vi.fn(),
}));
const mockTaskConstants = vi.hoisted(() => ({
  TASK_LIFECYCLE: {
    READY: 'ready',
  },
  TASK_STATUS: {
    IMPLEMENTING: 'implementing',
  },
  THREAD_STATUS: {
    APPROVED: 'approved',
    COMPLETED: 'completed',
  },
  THREAD_PURPOSE: {
    PLANNING: 'planning',
  },
  WORKFLOW_KIND: {
    EXEC: 'exec',
  },
}));

vi.mock('../planning', () => ({
  TASK_LIFECYCLE: mockTaskConstants.TASK_LIFECYCLE,
  THREAD_STATUS: mockTaskConstants.THREAD_STATUS,
  WORKFLOW_KIND: mockTaskConstants.WORKFLOW_KIND,
  recordTaskAgentResult: planningMocks.recordTaskAgentResult,
  transitionTaskWorkflow: planningMocks.transitionTaskWorkflow,
  updateTaskDelivery: planningMocks.updateTaskDelivery,
}));

import type { TaskWorktreeCommandRunner } from '../worktree';
import { runTaskAutoCommit } from './auto-commit';

const snapshot = {
  task: {
    taskId: 'task-1',
    title: '移动演示数据按钮',
    body: '删除下方的演示数据按钮应该位于礼薄列表上方。',
    source: 'web',
    status: mockTaskConstants.TASK_STATUS.IMPLEMENTING,
    activeThreadId: 'thread-1',
    repoOwner: 'ranwawa',
    repoName: 'along',
    cwd: '/tmp/along',
    commitShas: [],
    type: 'fix',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  thread: {
    threadId: 'thread-1',
    taskId: 'task-1',
    purpose: mockTaskConstants.THREAD_PURPOSE.PLANNING,
    status: mockTaskConstants.THREAD_STATUS.APPROVED,
    currentPlanId: 'plan-1',
    approvedPlanId: 'plan-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  currentPlan: null,
  openRound: null,
  artifacts: [],
  plans: [],
};

function ok(data = ''): Result<string> {
  return { success: true, data };
}

function err(error: string): Result<string> {
  return { success: false, error };
}

describe('task-auto-commit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    planningMocks.updateTaskDelivery.mockReturnValue({
      success: true,
      data: undefined,
    });
    planningMocks.transitionTaskWorkflow.mockReturnValue({
      success: true,
      data: undefined,
    });
    planningMocks.recordTaskAgentResult.mockReturnValue({
      success: true,
      data: {
        artifactId: 'art-auto-commit',
        taskId: 'task-1',
        threadId: 'thread-1',
        type: 'agent_result',
        role: 'agent',
        body: 'Auto-commit 完成',
        metadata: {},
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    });
  });

  it('当工作区有变更时，期望暂存并提交，同时记录 commit sha', async () => {
    const calls: string[] = [];
    let statusCount = 0;
    const runner: TaskWorktreeCommandRunner = async (command, args) => {
      calls.push(`${command} ${args.join(' ')}`);
      if (args[0] === 'status') {
        statusCount += 1;
        return statusCount === 1 ? ok(' M src/app.ts') : ok('');
      }
      if (args[0] === 'rev-parse') return ok('abc123');
      return ok('');
    };

    const result = await runTaskAutoCommit({
      snapshot,
      worktreePath: '/tmp/worktree',
      branchName: 'fix/demo-1',
      defaultBranch: 'main',
      commandRunner: runner,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.commitShas).toEqual(['abc123']);
    expect(result.data.commitMessage).toBe('fix(task): 完成移动演示数据按钮');
    expect(calls).toContain('git add -A');
    expect(calls).toContain('git commit -m fix(task): 完成移动演示数据按钮');
    expect(planningMocks.updateTaskDelivery).toHaveBeenCalledWith({
      taskId: 'task-1',
      worktreePath: '/tmp/worktree',
      branchName: 'fix/demo-1',
      commitShas: ['abc123'],
    });
    expect(planningMocks.transitionTaskWorkflow).toHaveBeenCalledWith({
      taskId: 'task-1',
      event: { type: 'exec.completed' },
    });
  });

  it('当 commit hook 写回格式化变更时，期望自动 amend 并保持工作区干净', async () => {
    const calls: string[] = [];
    let statusCount = 0;
    const runner: TaskWorktreeCommandRunner = async (command, args) => {
      calls.push(`${command} ${args.join(' ')}`);
      if (args[0] === 'status') {
        statusCount += 1;
        return statusCount <= 2 ? ok(' M src/app.ts') : ok('');
      }
      if (args[0] === 'rev-parse') return ok('amended123');
      return ok('');
    };

    const result = await runTaskAutoCommit({
      snapshot,
      worktreePath: '/tmp/worktree',
      branchName: 'fix/demo-1',
      defaultBranch: 'main',
      commandRunner: runner,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.commitShas).toEqual(['amended123']);
    expect(result.data.changedFiles).toEqual(['src/app.ts']);
    expect(calls).toContain('git commit --amend --no-edit');
  });

  it('当 commit hook 失败时，期望返回摘要并记录完整日志 artifact', async () => {
    const longError = `biome check failed\n${'x'.repeat(LONG_ERROR_LENGTH)}`;
    const runner: TaskWorktreeCommandRunner = async (_command, args) => {
      if (args[0] === 'status') return ok(' M src/app.ts');
      if (args[0] === 'commit') return err(longError);
      return ok('');
    };

    const result = await runTaskAutoCommit({
      snapshot,
      worktreePath: '/tmp/worktree',
      branchName: 'fix/demo-1',
      defaultBranch: 'main',
      commandRunner: runner,
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.summary.length).toBeLessThanOrEqual(
      MAX_FAILURE_SUMMARY_LENGTH,
    );
    expect(result.failureArtifactId).toBe('art-auto-commit');
    expect(planningMocks.updateTaskDelivery).not.toHaveBeenCalled();
    expect(planningMocks.recordTaskAgentResult).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'auto-commit',
        runtimeId: 'system',
        body: expect.stringContaining('完整输出'),
      }),
    );
  });

  it('当工作区干净但已有本地 commit 时，期望复用已有 commit', async () => {
    const runner: TaskWorktreeCommandRunner = async (_command, args) => {
      if (args[0] === 'status') return ok('');
      if (args[0] === 'rev-list') return ok('def456');
      return ok('');
    };

    const result = await runTaskAutoCommit({
      snapshot,
      worktreePath: '/tmp/worktree',
      branchName: 'fix/demo-1',
      defaultBranch: 'main',
      commandRunner: runner,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.alreadyCommitted).toBe(true);
    expect(result.data.commitShas).toEqual(['def456']);
  });
});
