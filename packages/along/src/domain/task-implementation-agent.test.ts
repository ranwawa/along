import { beforeEach, describe, expect, it, vi } from 'vitest';

const planningMocks = vi.hoisted(() => ({
  readTaskPlanningSnapshot: vi.fn(),
  updateTaskStatus: vi.fn(),
}));
const runnerMock = vi.hoisted(() => vi.fn());
const worktreeMock = vi.hoisted(() => vi.fn());

vi.mock('./task-planning', () => ({
  PLAN_STATUS: {
    APPROVED: 'approved',
  },
  TASK_STATUS: {
    PLANNING_APPROVED: 'planning_approved',
    IMPLEMENTING: 'implementing',
    IMPLEMENTED: 'implemented',
  },
  readTaskPlanningSnapshot: planningMocks.readTaskPlanningSnapshot,
  updateTaskStatus: planningMocks.updateTaskStatus,
}));

vi.mock('./task-agent-runtime', () => ({
  runTaskAgentTurn: runnerMock,
}));

vi.mock('./task-worktree', () => ({
  prepareTaskWorktree: worktreeMock,
}));

import { runTaskImplementationAgent } from './task-implementation-agent';

const approvedSnapshot = {
  task: {
    taskId: 'task-1',
    title: '移动演示数据按钮',
    body: '删除下方的演示数据按钮应该位于礼薄列表上方。',
    source: 'web',
    status: 'planning_approved',
    activeThreadId: 'thread-1',
    repoOwner: 'ranwawa',
    repoName: 'kinkeeper',
    cwd: '/tmp/kinkeeper',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  thread: {
    threadId: 'thread-1',
    taskId: 'task-1',
    purpose: 'planning',
    status: 'approved',
    currentPlanId: 'plan-1',
    approvedPlanId: 'plan-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  currentPlan: {
    planId: 'plan-1',
    taskId: 'task-1',
    threadId: 'thread-1',
    version: 1,
    status: 'approved',
    artifactId: 'art-plan',
    body: '## 方案\n\n移动按钮。',
    createdAt: '2026-01-01T00:00:01.000Z',
  },
  openRound: null,
  artifacts: [
    {
      artifactId: 'art-plan',
      taskId: 'task-1',
      threadId: 'thread-1',
      type: 'plan_revision',
      role: 'agent',
      body: '## 方案\n\n移动按钮。',
      metadata: { planId: 'plan-1' },
      createdAt: '2026-01-01T00:00:01.000Z',
    },
  ],
  plans: [
    {
      planId: 'plan-1',
      taskId: 'task-1',
      threadId: 'thread-1',
      version: 1,
      status: 'approved',
      artifactId: 'art-plan',
      body: '## 方案\n\n移动按钮。',
      createdAt: '2026-01-01T00:00:01.000Z',
    },
  ],
};

describe('task-implementation-agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    planningMocks.readTaskPlanningSnapshot.mockReturnValue({
      success: true,
      data: approvedSnapshot,
    });
    planningMocks.updateTaskStatus.mockReturnValue({
      success: true,
      data: undefined,
    });
    worktreeMock.mockResolvedValue({
      success: true,
      data: {
        worktreePath: '/tmp/along-task-worktree',
        branchName: 'along-task/task-1-demo',
        defaultBranch: 'main',
      },
    });
    runnerMock.mockResolvedValue({
      success: true,
      data: {
        run: {
          runId: 'run-1',
          taskId: 'task-1',
          threadId: 'thread-1',
          agentId: 'implementer',
          provider: 'claude',
          status: 'succeeded',
          inputArtifactIds: ['art-plan'],
          outputArtifactIds: ['art-result'],
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: '2026-01-01T00:00:01.000Z',
        },
        usedResume: false,
        assistantText: '实现完成，已运行相关测试。',
        outputArtifactIds: ['art-result'],
      },
    });
  });

  it('当 Task 有已批准方案时，期望启动实现 Agent 并更新状态', async () => {
    const result = await runTaskImplementationAgent({
      taskId: 'task-1',
      cwd: '/tmp/kinkeeper',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(planningMocks.updateTaskStatus).toHaveBeenNthCalledWith(
      1,
      'task-1',
      'implementing',
    );
    expect(planningMocks.updateTaskStatus).toHaveBeenNthCalledWith(
      2,
      'task-1',
      'implemented',
    );
    expect(runnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        threadId: 'thread-1',
        agentId: 'implementer',
        cwd: '/tmp/along-task-worktree',
        options: expect.objectContaining({
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
        }),
      }),
    );
  });

  it('当实现 Agent 失败时，期望回到 planning_approved 以便重试', async () => {
    runnerMock.mockResolvedValueOnce({
      success: false,
      error: '执行失败',
    });

    const result = await runTaskImplementationAgent({
      taskId: 'task-1',
      cwd: '/tmp/kinkeeper',
    });

    expect(result.success).toBe(false);
    expect(planningMocks.updateTaskStatus).toHaveBeenNthCalledWith(
      2,
      'task-1',
      'planning_approved',
    );
  });

  it('当 Task worktree 准备失败时，期望拒绝启动实现', async () => {
    worktreeMock.mockResolvedValueOnce({
      success: false,
      error: '创建 Task worktree 失败',
    });

    const result = await runTaskImplementationAgent({
      taskId: 'task-1',
      cwd: '/tmp/kinkeeper',
    });

    expect(result.success).toBe(false);
    expect(runnerMock).not.toHaveBeenCalled();
    expect(planningMocks.updateTaskStatus).not.toHaveBeenCalled();
  });
});
