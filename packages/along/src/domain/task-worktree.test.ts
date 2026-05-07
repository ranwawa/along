import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '../core/result';

const planningMocks = vi.hoisted(() => ({
  updateTaskDelivery: vi.fn(),
  updateTaskRepository: vi.fn(),
}));
const mockTaskConstants = vi.hoisted(() => ({
  TASK_STATUS: {
    PLANNING_APPROVED: 'planning_approved',
  },
  THREAD_PURPOSE: {
    PLANNING: 'planning',
  },
  THREAD_STATUS: {
    APPROVED: 'approved',
  },
}));

vi.mock('./task-planning', () => ({
  updateTaskDelivery: planningMocks.updateTaskDelivery,
  updateTaskRepository: planningMocks.updateTaskRepository,
}));

vi.mock('./worktree-init', () => ({
  getDefaultBranch: vi.fn(),
}));

import {
  defaultTaskWorktreeCommandRunner,
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
    status: mockTaskConstants.TASK_STATUS.PLANNING_APPROVED,
    activeThreadId: 'thread-1',
    repoOwner: 'ranwawa',
    repoName: 'kinkeeper',
    cwd: '/repo/kinkeeper',
    commitShas: [],
    seq: 42,
    type: 'fix',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  thread: {
    threadId: 'thread-1',
    taskId: 'task_123456789abc',
    purpose: mockTaskConstants.THREAD_PURPOSE.PLANNING,
    status: mockTaskConstants.THREAD_STATUS.APPROVED,
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
    planningMocks.updateTaskRepository.mockReturnValue({
      success: true,
      data: undefined,
    });
  });

  it('执行命令时保留 stdout 前导空格，避免破坏 git porcelain 输出', async () => {
    const result = await defaultTaskWorktreeCommandRunner(
      process.execPath,
      ['-e', "process.stdout.write(' M src/app.ts\\n')"],
      { cwd: process.cwd() },
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data).toBe(' M src/app.ts');
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
    expect(result.data.branchName).toMatch(/^fix\/.*-42/);
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
      branchName: result.data.branchName,
      worktreePath,
    });
  });

  it('当旧 Task 缺少 owner/repo 时，期望从 git origin 推断并写回 Task', async () => {
    const worktreePath = path.join(
      os.tmpdir(),
      `along-task-worktree-infer-${Date.now()}`,
      'worktree',
    );
    const runner: TaskWorktreeCommandRunner = async (
      command,
      args,
      options,
    ) => {
      if (command === 'git' && args.join(' ') === 'remote get-url origin') {
        expect(options.cwd).toBe('/repo/kinkeeper');
        return ok('git@github.com:ranwawa/kinkeeper.git');
      }
      if (command === 'git' && args[0] === 'rev-parse') return err('not found');
      return ok('');
    };

    const result = await prepareTaskWorktree({
      snapshot: {
        ...snapshot,
        task: {
          ...snapshot.task,
          repoOwner: undefined,
          repoName: undefined,
          seq: undefined,
          worktreePath,
        },
      },
      repoPath: '/repo/kinkeeper',
      commandRunner: runner,
      readDefaultBranch: async () => ok('main'),
    });

    expect(result.success).toBe(true);
    expect(planningMocks.updateTaskRepository).toHaveBeenCalledWith({
      taskId: 'task_123456789abc',
      repoOwner: 'ranwawa',
      repoName: 'kinkeeper',
      cwd: '/repo/kinkeeper',
    });
  });
});
