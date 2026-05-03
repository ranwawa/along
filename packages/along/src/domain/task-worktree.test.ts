import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '../core/result';

const planningMocks = vi.hoisted(() => ({
  updateTaskDelivery: vi.fn(),
}));

vi.mock('./task-planning', () => ({
  updateTaskDelivery: planningMocks.updateTaskDelivery,
}));

vi.mock('./worktree-init', () => ({
  getDefaultBranch: vi.fn(),
}));

import {
  prepareTaskWorktree,
  type TaskWorktreeCommandRunner,
} from './task-worktree';

function ok(data = ''): Result<string> {
  return { success: true, data };
}

function err(error: string): Result<string> {
  return { success: false, error };
}

const snapshot = {
  task: {
    taskId: 'task_123456789abc',
    title: '移动演示数据按钮',
    body: '删除下方的演示数据按钮应该位于礼薄列表上方。',
    source: 'web',
    status: 'planning_approved',
    activeThreadId: 'thread-1',
    repoOwner: 'ranwawa',
    repoName: 'kinkeeper',
    cwd: '/repo/kinkeeper',
    commitShas: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  thread: {
    threadId: 'thread-1',
    taskId: 'task_123456789abc',
    purpose: 'planning',
    status: 'approved',
    approvedPlanId: 'plan-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  currentPlan: null,
  openRound: null,
  artifacts: [],
  plans: [],
};

describe('task-worktree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    planningMocks.updateTaskDelivery.mockReturnValue({
      success: true,
      data: undefined,
    });
  });

  it('为 Task 创建独立 worktree，并把 branch/worktree 写回 Task', async () => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const worktreePath = path.join(
      os.tmpdir(),
      `along-task-worktree-${Date.now()}`,
      'worktree',
    );
    const runner: TaskWorktreeCommandRunner = async (
      command,
      args,
      options,
    ) => {
      calls.push({ command, args, cwd: options.cwd });
      if (command === 'git' && args[0] === 'rev-parse') return err('not found');
      return ok('');
    };

    const result = await prepareTaskWorktree({
      snapshot: {
        ...snapshot,
        task: {
          ...snapshot.task,
          worktreePath,
        },
      },
      repoPath: '/repo/kinkeeper',
      commandRunner: runner,
      readDefaultBranch: async () => ok('main'),
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.worktreePath).toBe(worktreePath);
    expect(result.data.branchName).toMatch(/^along-task\/12345678-/);
    expect(calls).toContainEqual({
      command: 'git',
      cwd: '/repo/kinkeeper',
      args: [
        'worktree',
        'add',
        '-B',
        result.data.branchName,
        worktreePath,
        'origin/main',
      ],
    });
    expect(planningMocks.updateTaskDelivery).toHaveBeenCalledWith({
      taskId: 'task_123456789abc',
      status: 'planning_approved',
      branchName: result.data.branchName,
      worktreePath,
    });
  });
});
