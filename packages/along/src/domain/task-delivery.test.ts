import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '../core/result';

const planningMocks = vi.hoisted(() => ({
  createTaskAgentRun: vi.fn(),
  finishTaskAgentRun: vi.fn(),
  readTaskPlanningSnapshot: vi.fn(),
  recordTaskAgentResult: vi.fn(),
  updateTaskDelivery: vi.fn(),
  updateTaskRepository: vi.fn(),
  updateTaskWorkflowState: vi.fn(),
}));
const mockTaskConstants = vi.hoisted(() => ({
  AGENT_RUN_STATUS: {
    RUNNING: 'running',
    SUCCEEDED: 'succeeded',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
  },
  TASK_LIFECYCLE: {
    CANCELLED: 'cancelled',
    READY: 'ready',
    RUNNING: 'running',
  },
  TASK_STATUS: {
    IMPLEMENTED: 'implemented',
  },
  THREAD_STATUS: {
    APPROVED: 'approved',
    COMPLETED: 'completed',
    VERIFYING: 'verifying',
  },
  THREAD_PURPOSE: {
    PLANNING: 'planning',
  },
  WORKFLOW_KIND: {
    IMPLEMENTATION: 'implementation',
  },
}));

vi.mock('./task-planning', () => ({
  AGENT_RUN_STATUS: mockTaskConstants.AGENT_RUN_STATUS,
  TASK_LIFECYCLE: mockTaskConstants.TASK_LIFECYCLE,
  THREAD_STATUS: mockTaskConstants.THREAD_STATUS,
  WORKFLOW_KIND: mockTaskConstants.WORKFLOW_KIND,
  createTaskAgentRun: planningMocks.createTaskAgentRun,
  finishTaskAgentRun: planningMocks.finishTaskAgentRun,
  readTaskPlanningSnapshot: planningMocks.readTaskPlanningSnapshot,
  recordTaskAgentResult: planningMocks.recordTaskAgentResult,
  updateTaskDelivery: planningMocks.updateTaskDelivery,
  updateTaskRepository: planningMocks.updateTaskRepository,
  updateTaskWorkflowState: planningMocks.updateTaskWorkflowState,
}));

vi.mock('../integration/github-client', () => ({
  readGithubToken: vi.fn(),
}));

vi.mock('./worktree-init', () => ({
  getDefaultBranch: vi.fn(),
}));

import {
  runTaskDelivery,
  type TaskDeliveryCommandRunner,
} from './task-delivery';

const snapshot = {
  task: {
    taskId: 'task_123456789abc',
    title: '移动演示数据按钮',
    body: '删除下方的演示数据按钮应该位于礼薄列表上方。',
    source: 'web',
    status: mockTaskConstants.TASK_STATUS.IMPLEMENTED,
    lifecycle: mockTaskConstants.TASK_LIFECYCLE.READY,
    currentWorkflowKind: mockTaskConstants.WORKFLOW_KIND.IMPLEMENTATION,
    activeThreadId: 'thread-1',
    repoOwner: 'ranwawa',
    repoName: 'kinkeeper',
    cwd: '/tmp/kinkeeper',
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
    currentPlanId: 'plan-1',
    approvedPlanId: 'plan-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  currentPlan: null,
  openRound: null,
  artifacts: [],
  plans: [
    {
      planId: 'plan-1',
      taskId: 'task_123456789abc',
      threadId: 'thread-1',
      version: 1,
      status: mockTaskConstants.THREAD_STATUS.APPROVED,
      artifactId: 'art-plan',
      body: '## 方案\n\n移动按钮。',
      createdAt: '2026-01-01T00:00:01.000Z',
    },
  ],
};

function ok(data = ''): Result<string> {
  return { success: true, data };
}

function err(error: string): Result<string> {
  return { success: false, error };
}

describe('task-delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    planningMocks.readTaskPlanningSnapshot.mockReturnValue({
      success: true,
      data: snapshot,
    });
    planningMocks.updateTaskDelivery.mockReturnValue({
      success: true,
      data: undefined,
    });
    planningMocks.updateTaskRepository.mockReturnValue({
      success: true,
      data: undefined,
    });
    planningMocks.updateTaskWorkflowState.mockReturnValue({
      success: true,
      data: undefined,
    });
    planningMocks.createTaskAgentRun.mockReturnValue({
      success: true,
      data: {
        runId: 'run-delivery',
        taskId: 'task_123456789abc',
        threadId: 'thread-1',
        agentId: 'delivery',
        provider: 'system',
        status: mockTaskConstants.AGENT_RUN_STATUS.RUNNING,
        inputArtifactIds: ['art-plan'],
        outputArtifactIds: [],
        startedAt: '2026-01-01T00:00:01.000Z',
      },
    });
    planningMocks.finishTaskAgentRun.mockReturnValue({
      success: true,
      data: {
        runId: 'run-delivery',
        taskId: 'task_123456789abc',
        threadId: 'thread-1',
        agentId: 'delivery',
        provider: 'system',
        status: 'succeeded',
        inputArtifactIds: ['art-plan'],
        outputArtifactIds: [],
        startedAt: '2026-01-01T00:00:01.000Z',
        endedAt: '2026-01-01T00:00:02.000Z',
      },
    });
    planningMocks.recordTaskAgentResult.mockReturnValue({
      success: true,
      data: {
        artifactId: 'art-delivery',
        taskId: 'task_123456789abc',
        threadId: 'thread-1',
        type: 'agent_result',
        role: 'agent',
        body: 'Delivery 完成',
        metadata: {},
        createdAt: '2026-01-01T00:00:02.000Z',
      },
    });
  });

  it('当 Task 已实现且已有 commit 时，期望推送并创建带 Task 标记的 PR', async () => {
    planningMocks.readTaskPlanningSnapshot.mockReturnValue({
      success: true,
      data: {
        ...snapshot,
        task: { ...snapshot.task, commitShas: ['abc123'] },
      },
    });
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    let prBody = '';
    const runner: TaskDeliveryCommandRunner = async (
      command,
      args,
      options,
    ) => {
      calls.push({ command, args, cwd: options.cwd });
      if (command === 'git' && args[0] === 'status') {
        return ok('');
      }
      if (command === 'git' && args[0] === 'diff') {
        return ok('packages/client/src/pages/home/list.tsx');
      }
      if (command === 'git' && args[0] === 'rev-parse') {
        if (args.includes('--verify')) return err('not found');
        return ok('abc123');
      }
      if (command === 'gh') {
        const bodyFile = args[args.indexOf('--body-file') + 1];
        prBody = fs.readFileSync(bodyFile, 'utf-8');
        return ok('https://github.com/ranwawa/kinkeeper/pull/42');
      }
      return ok('');
    };

    const result = await runTaskDelivery({
      taskId: 'task_123456789abc',
      cwd: '/tmp/kinkeeper',
      commandRunner: runner,
      readToken: async () => ok('token'),
      readDefaultBranch: async () => ok('main'),
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.prNumber).toBe(42);
    expect(planningMocks.updateTaskDelivery).toHaveBeenNthCalledWith(1, {
      taskId: 'task_123456789abc',
      branchName: expect.stringMatching(/^fix\/.*-42/),
      worktreePath: expect.stringContaining(
        '/ranwawa/kinkeeper/tasks/42/worktree',
      ),
    });
    expect(planningMocks.updateTaskDelivery).toHaveBeenNthCalledWith(2, {
      taskId: 'task_123456789abc',
      branchName: expect.stringMatching(/^fix\/.*-42/),
      worktreePath: expect.stringContaining(
        '/ranwawa/kinkeeper/tasks/42/worktree',
      ),
    });
    expect(planningMocks.updateTaskDelivery).toHaveBeenLastCalledWith({
      taskId: 'task_123456789abc',
      branchName: expect.stringMatching(/^fix\/.*-42/),
      commitShas: ['abc123'],
      prUrl: 'https://github.com/ranwawa/kinkeeper/pull/42',
      prNumber: 42,
    });
    expect(planningMocks.updateTaskWorkflowState).toHaveBeenCalledWith({
      taskId: 'task_123456789abc',
      lifecycle: mockTaskConstants.TASK_LIFECYCLE.RUNNING,
      currentWorkflowKind: mockTaskConstants.WORKFLOW_KIND.IMPLEMENTATION,
      threadStatus: mockTaskConstants.THREAD_STATUS.VERIFYING,
    });
    expect(planningMocks.updateTaskWorkflowState).toHaveBeenLastCalledWith({
      taskId: 'task_123456789abc',
      lifecycle: mockTaskConstants.TASK_LIFECYCLE.READY,
      currentWorkflowKind: mockTaskConstants.WORKFLOW_KIND.IMPLEMENTATION,
      threadStatus: mockTaskConstants.THREAD_STATUS.COMPLETED,
    });
    expect(calls.map((call) => `${call.command} ${call.args[0]}`)).toContain(
      'gh pr',
    );
    expect(calls.map((call) => `git ${call.args[0]}`)).not.toContain(
      'git commit',
    );
    expect(
      calls.find((call) => call.command === 'git' && call.args[0] === 'status'),
    ).toEqual(
      expect.objectContaining({
        command: 'git',
        cwd: expect.stringContaining('/ranwawa/kinkeeper/tasks/42/worktree'),
      }),
    );
    expect(prBody).toContain('along-task: #42');
    expect(prBody).not.toMatch(/(?:fixes|closes|resolves)\s+#\d+/i);
  });

  it('当没有已提交 commit 时，期望回到已实现状态并返回失败', async () => {
    const runner: TaskDeliveryCommandRunner = async (command, args) => {
      if (command === 'git' && args[0] === 'status') return ok('');
      if (command === 'git' && args[0] === 'rev-list') return ok('');
      return ok('');
    };

    const result = await runTaskDelivery({
      taskId: 'task_123456789abc',
      cwd: '/tmp/kinkeeper',
      commandRunner: runner,
      readToken: async () => ok('token'),
      readDefaultBranch: async () => ok('main'),
    });

    expect(result.success).toBe(false);
    expect(planningMocks.updateTaskWorkflowState).toHaveBeenLastCalledWith({
      taskId: 'task_123456789abc',
      lifecycle: mockTaskConstants.TASK_LIFECYCLE.READY,
      currentWorkflowKind: mockTaskConstants.WORKFLOW_KIND.IMPLEMENTATION,
      threadStatus: mockTaskConstants.THREAD_STATUS.COMPLETED,
    });
  });

  it('当旧 Task 缺少 owner/repo 时，期望从 git origin 推断后创建 PR', async () => {
    planningMocks.readTaskPlanningSnapshot.mockReturnValue({
      success: true,
      data: {
        ...snapshot,
        task: {
          ...snapshot.task,
          repoOwner: undefined,
          repoName: undefined,
          seq: undefined,
          commitShas: ['abc123'],
        },
      },
    });

    const ghCalls: string[][] = [];
    const runner: TaskDeliveryCommandRunner = async (command, args) => {
      if (command === 'git' && args.join(' ') === 'remote get-url origin') {
        return ok('https://github.com/ranwawa/kinkeeper.git');
      }
      if (command === 'git' && args[0] === 'status') {
        return ok('');
      }
      if (command === 'git' && args[0] === 'diff') {
        return ok('packages/client/src/pages/home/list.tsx');
      }
      if (command === 'git' && args[0] === 'rev-parse') {
        if (args.includes('--verify')) return err('not found');
        return ok('abc123');
      }
      if (command === 'gh') {
        ghCalls.push(args);
        return ok('https://github.com/ranwawa/kinkeeper/pull/43');
      }
      return ok('');
    };

    const result = await runTaskDelivery({
      taskId: 'task_123456789abc',
      cwd: '/tmp/kinkeeper',
      commandRunner: runner,
      readToken: async () => ok('token'),
      readDefaultBranch: async () => ok('main'),
    });

    expect(result.success).toBe(true);
    expect(planningMocks.updateTaskRepository).toHaveBeenCalledWith({
      taskId: 'task_123456789abc',
      repoOwner: 'ranwawa',
      repoName: 'kinkeeper',
      cwd: '/tmp/kinkeeper',
    });
    expect(ghCalls[0]).toContain('--repo');
    expect(ghCalls[0][ghCalls[0].indexOf('--repo') + 1]).toBe(
      'ranwawa/kinkeeper',
    );
  });
});
