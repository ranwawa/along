import { beforeEach, describe, expect, it, vi } from 'vitest';

const planningMocks = vi.hoisted(() => ({
  readTaskPlanningSnapshot: vi.fn(),
  updateTaskWorkflowState: vi.fn(),
}));
const runnerMock = vi.hoisted(() => vi.fn());
const worktreeMock = vi.hoisted(() => vi.fn());
const autoCommitMock = vi.hoisted(() => vi.fn());
const mockTaskConstants = vi.hoisted(() => ({
  PLAN_STATUS: {
    APPROVED: 'approved',
  },
  TASK_LIFECYCLE: {
    CANCELLED: 'cancelled',
    READY: 'ready',
    RUNNING: 'running',
  },
  TASK_STATUS: {
    PLANNING_APPROVED: 'planning_approved',
  },
  THREAD_STATUS: {
    APPROVED: 'approved',
    IMPLEMENTING: 'implementing',
  },
  THREAD_PURPOSE: {
    PLANNING: 'planning',
  },
  WORKFLOW_KIND: {
    PLANNING: 'planning',
    IMPLEMENTATION: 'implementation',
  },
}));

vi.mock('./task-planning', () => ({
  PLAN_STATUS: mockTaskConstants.PLAN_STATUS,
  TASK_LIFECYCLE: mockTaskConstants.TASK_LIFECYCLE,
  THREAD_STATUS: mockTaskConstants.THREAD_STATUS,
  WORKFLOW_KIND: mockTaskConstants.WORKFLOW_KIND,
  readTaskPlanningSnapshot: planningMocks.readTaskPlanningSnapshot,
  updateTaskWorkflowState: planningMocks.updateTaskWorkflowState,
}));

vi.mock('./task-agent-runtime', () => ({
  runTaskAgentTurn: runnerMock,
}));

vi.mock('./task-worktree', () => ({
  defaultTaskWorktreeCommandRunner: vi.fn(),
  prepareTaskWorktree: worktreeMock,
}));

vi.mock('./task-auto-commit', () => ({
  runTaskAutoCommit: autoCommitMock,
}));

import { runTaskImplementationAgent } from './task-implementation-agent';

const approvedSnapshot = {
  task: {
    taskId: 'task-1',
    title: '移动演示数据按钮',
    body: '删除下方的演示数据按钮应该位于礼薄列表上方。',
    source: 'web',
    status: mockTaskConstants.TASK_STATUS.PLANNING_APPROVED,
    lifecycle: mockTaskConstants.TASK_LIFECYCLE.READY,
    currentWorkflowKind: mockTaskConstants.WORKFLOW_KIND.PLANNING,
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
    purpose: mockTaskConstants.THREAD_PURPOSE.PLANNING,
    status: mockTaskConstants.THREAD_STATUS.APPROVED,
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
    status: mockTaskConstants.PLAN_STATUS.APPROVED,
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
      status: mockTaskConstants.PLAN_STATUS.APPROVED,
      artifactId: 'art-plan',
      body: '## 方案\n\n移动按钮。',
      createdAt: '2026-01-01T00:00:01.000Z',
    },
  ],
};

const stepsArtifact = {
  artifactId: 'art-steps',
  taskId: 'task-1',
  threadId: 'thread-1',
  type: 'agent_result',
  role: 'agent',
  body: '## 实施步骤\n\n1. 先检查状态。',
  metadata: {
    kind: 'implementation_steps',
    planId: 'plan-1',
    planVersion: 1,
  },
  createdAt: '2026-01-01T00:00:02.000Z',
};

const stepsApprovalArtifact = {
  artifactId: 'art-steps-approval',
  taskId: 'task-1',
  threadId: 'thread-1',
  type: 'approval',
  role: 'user',
  body: 'Approved Implementation Steps for Plan v1',
  metadata: {
    kind: 'implementation_steps_approval',
    planId: 'plan-1',
    stepsArtifactId: 'art-steps',
  },
  createdAt: '2026-01-01T00:00:03.000Z',
};

const stepsSnapshot = {
  ...approvedSnapshot,
  artifacts: [...approvedSnapshot.artifacts, stepsArtifact],
};

const confirmedSnapshot = {
  ...approvedSnapshot,
  artifacts: [
    ...approvedSnapshot.artifacts,
    stepsArtifact,
    stepsApprovalArtifact,
  ],
};

describe('task-implementation-agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    planningMocks.readTaskPlanningSnapshot.mockReturnValue({
      success: true,
      data: approvedSnapshot,
    });
    planningMocks.updateTaskWorkflowState.mockReturnValue({
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
          provider: 'codex',
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
    autoCommitMock.mockResolvedValue({
      success: true,
      data: {
        commitShas: ['abc123'],
        changedFiles: ['src/app.ts'],
        commitMessage: 'fix(task): 完成移动演示数据按钮',
        alreadyCommitted: false,
      },
    });
  });

  it('当 Task 有已批准方案但没有实施步骤时，期望只产出实施步骤且不修改工作区', async () => {
    const result = await runTaskImplementationAgent({
      taskId: 'task-1',
      cwd: '/tmp/kinkeeper',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(planningMocks.updateTaskWorkflowState).not.toHaveBeenCalled();
    expect(worktreeMock).not.toHaveBeenCalled();
    expect(autoCommitMock).not.toHaveBeenCalled();
    expect(result.data.commitShas).toEqual([]);
    expect(runnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        threadId: 'thread-1',
        agentId: 'implementer',
        cwd: '/tmp/kinkeeper',
        outputMetadata: expect.objectContaining({
          kind: 'implementation_steps',
          planId: 'plan-1',
        }),
        codexOptions: expect.objectContaining({
          sandboxMode: 'read-only',
        }),
        prompt: expect.stringContaining('产出可执行的详细实施步骤'),
      }),
    );
  });

  it('当实施步骤未确认时，期望拒绝进入编码和提交阶段', async () => {
    planningMocks.readTaskPlanningSnapshot.mockReturnValue({
      success: true,
      data: stepsSnapshot,
    });

    const result = await runTaskImplementationAgent({
      taskId: 'task-1',
      cwd: '/tmp/kinkeeper',
    });

    expect(result.success).toBe(false);
    expect(runnerMock).not.toHaveBeenCalled();
    expect(worktreeMock).not.toHaveBeenCalled();
    expect(autoCommitMock).not.toHaveBeenCalled();
    expect(planningMocks.updateTaskWorkflowState).not.toHaveBeenCalled();
  });

  it('当实施步骤已人工确认时，期望启动实现 Agent 并在完成后自动提交', async () => {
    planningMocks.readTaskPlanningSnapshot.mockReturnValue({
      success: true,
      data: confirmedSnapshot,
    });

    const result = await runTaskImplementationAgent({
      taskId: 'task-1',
      cwd: '/tmp/kinkeeper',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(planningMocks.updateTaskWorkflowState).toHaveBeenNthCalledWith(1, {
      taskId: 'task-1',
      lifecycle: mockTaskConstants.TASK_LIFECYCLE.RUNNING,
      currentWorkflowKind: mockTaskConstants.WORKFLOW_KIND.IMPLEMENTATION,
      threadStatus: mockTaskConstants.THREAD_STATUS.IMPLEMENTING,
    });
    expect(planningMocks.updateTaskWorkflowState).toHaveBeenCalledTimes(1);
    expect(result.data.commitShas).toEqual(['abc123']);
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
    expect(autoCommitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: '/tmp/along-task-worktree',
        branchName: 'along-task/task-1-demo',
        defaultBranch: 'main',
      }),
    );
  });

  it('当实现 Agent 失败时，期望回到 planning_approved 以便重试', async () => {
    planningMocks.readTaskPlanningSnapshot.mockReturnValue({
      success: true,
      data: confirmedSnapshot,
    });
    runnerMock.mockResolvedValueOnce({
      success: false,
      error: '执行失败',
    });

    const result = await runTaskImplementationAgent({
      taskId: 'task-1',
      cwd: '/tmp/kinkeeper',
    });

    expect(result.success).toBe(false);
    expect(planningMocks.updateTaskWorkflowState).toHaveBeenNthCalledWith(2, {
      taskId: 'task-1',
      lifecycle: mockTaskConstants.TASK_LIFECYCLE.READY,
      currentWorkflowKind: mockTaskConstants.WORKFLOW_KIND.PLANNING,
      threadStatus: mockTaskConstants.THREAD_STATUS.APPROVED,
    });
  });

  it('当 auto-commit 失败后，期望反馈错误给实现 Agent 修复并重试提交', async () => {
    planningMocks.readTaskPlanningSnapshot.mockReturnValue({
      success: true,
      data: confirmedSnapshot,
    });
    autoCommitMock
      .mockResolvedValueOnce({
        success: false,
        error: '提交失败: biome check failed',
        command: 'git commit -m "fix(task): 完成移动演示数据按钮"',
        summary: 'biome check failed',
        changedFiles: ['src/app.ts'],
        failureArtifactId: 'art-commit-failure',
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          commitShas: ['def456'],
          changedFiles: ['src/app.ts'],
          commitMessage: 'fix(task): 完成移动演示数据按钮',
          alreadyCommitted: false,
        },
      });

    const result = await runTaskImplementationAgent({
      taskId: 'task-1',
      cwd: '/tmp/kinkeeper',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.commitShas).toEqual(['def456']);
    expect(runnerMock).toHaveBeenCalledTimes(2);
    expect(runnerMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        prompt: expect.stringContaining('auto-commit 子步骤'),
        inputArtifactIds: expect.arrayContaining(['art-commit-failure']),
      }),
    );
    expect(autoCommitMock).toHaveBeenCalledTimes(2);
  });

  it('当 Task worktree 准备失败时，期望拒绝启动实现', async () => {
    planningMocks.readTaskPlanningSnapshot.mockReturnValue({
      success: true,
      data: confirmedSnapshot,
    });
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
    expect(planningMocks.updateTaskWorkflowState).not.toHaveBeenCalled();
  });
});
