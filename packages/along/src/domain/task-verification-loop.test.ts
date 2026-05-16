import { beforeEach, describe, expect, it, vi } from 'vitest';

const planningMocks = vi.hoisted(() => ({
  readTaskPlanningSnapshot: vi.fn(),
  recordTaskAgentResult: vi.fn(() => ({
    success: true,
    data: { artifactId: 'art-1' },
  })),
  transitionTaskWorkflow: vi.fn(() => ({ success: true, data: undefined })),
}));

vi.mock('./task-planning', () => ({
  readTaskPlanningSnapshot: planningMocks.readTaskPlanningSnapshot,
  recordTaskAgentResult: planningMocks.recordTaskAgentResult,
  transitionTaskWorkflow: planningMocks.transitionTaskWorkflow,
}));

const verificationGateMock = vi.hoisted(() => ({
  runVerificationGate: vi.fn(),
  loadProductionContract: vi.fn(),
}));

vi.mock('./task-verification-gate', () => ({
  runVerificationGate: verificationGateMock.runVerificationGate,
  loadProductionContract: verificationGateMock.loadProductionContract,
}));

const agentRuntimeMock = vi.hoisted(() => ({
  runTaskAgentTurn: vi.fn(),
}));

vi.mock('./task-agent-runtime', () => ({
  runTaskAgentTurn: agentRuntimeMock.runTaskAgentTurn,
}));

const autoCommitMock = vi.hoisted(() => ({
  runTaskAutoCommit: vi.fn(),
}));

vi.mock('./task-auto-commit', () => ({
  runTaskAutoCommit: autoCommitMock.runTaskAutoCommit,
}));

const verifyPromptMock = vi.hoisted(() => ({
  buildVerificationFixPrompt: vi.fn(() => 'fix prompt'),
}));

vi.mock('../agents/task-verify', () => ({
  buildVerificationFixPrompt: verifyPromptMock.buildVerificationFixPrompt,
}));

import { runVerificationLoop } from './task-verification-loop';
import type { TaskWorktreeCommandRunner } from './task-worktree';

const mockRunner: TaskWorktreeCommandRunner = async () => ({
  success: true,
  data: '',
});

const baseInput = {
  taskInput: { taskId: 'task-1', cwd: '/repo', agentId: 'implementer' },
  snapshot: {
    task: { taskId: 'task-1', title: 'test', body: 'body' },
    thread: { threadId: 'thread-1' },
    artifacts: [],
  },
  approvedPlan: { planId: 'plan-1', version: 1, body: 'plan body' },
  worktree: {
    worktreePath: '/tmp/wt',
    branchName: 'task/task-1',
    defaultBranch: 'main',
    workspaceMode: 'worktree' as const,
  },
  agentId: 'implementer',
  commandRunner: mockRunner,
  assistantText: 'done',
  commitShas: ['abc123'],
};

const passedGateOutput = {
  passed: true,
  results: [{ name: 'lint', passed: true, output: '', durationMs: 100 }],
  summary: '验证通过',
};

const failedGateOutput = {
  passed: false,
  results: [
    {
      name: 'lint',
      passed: false,
      output: 'error: unused var',
      durationMs: 50,
    },
  ],
  summary: '验证失败：lint',
};

const defaultContract = {
  version: 1,
  verify: {
    commands: [
      { name: 'lint', command: 'bunx', args: ['biome', 'check', '.'] },
    ],
    maxFixAttempts: 2,
    timeoutMs: 300_000,
  },
};

describe('runVerificationLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verificationGateMock.loadProductionContract.mockResolvedValue(
      defaultContract,
    );
    planningMocks.readTaskPlanningSnapshot.mockReturnValue({
      success: true,
      data: baseInput.snapshot,
    });
  });

  it('当验证通过时，fire exec.verified 并返回成功', async () => {
    verificationGateMock.runVerificationGate.mockResolvedValue(
      passedGateOutput,
    );

    const result = await runVerificationLoop(baseInput as never);

    expect(result.success).toBe(true);
    expect(planningMocks.transitionTaskWorkflow).toHaveBeenCalledWith({
      taskId: 'task-1',
      event: { type: 'exec.verified' },
    });
  });

  it('当验证失败且修复成功时，重新验证并通过', async () => {
    verificationGateMock.runVerificationGate
      .mockResolvedValueOnce(failedGateOutput)
      .mockResolvedValueOnce(passedGateOutput);
    agentRuntimeMock.runTaskAgentTurn.mockResolvedValue({
      success: true,
      data: { assistantText: 'fixed', run: { status: 'succeeded' } },
    });
    autoCommitMock.runTaskAutoCommit.mockResolvedValue({
      success: true,
      data: { commitShas: ['def456'], changedFiles: [], commitMessage: 'fix' },
    });

    const result = await runVerificationLoop(baseInput as never);

    expect(result.success).toBe(true);
    expect(agentRuntimeMock.runTaskAgentTurn).toHaveBeenCalledTimes(1);
    expect(planningMocks.transitionTaskWorkflow).toHaveBeenCalledWith({
      taskId: 'task-1',
      event: { type: 'exec.verified' },
    });
  });

  it('当超过最大修复次数时，fire task.failed', async () => {
    verificationGateMock.runVerificationGate.mockResolvedValue(
      failedGateOutput,
    );
    agentRuntimeMock.runTaskAgentTurn.mockResolvedValue({
      success: true,
      data: { assistantText: 'tried', run: { status: 'succeeded' } },
    });
    autoCommitMock.runTaskAutoCommit.mockResolvedValue({
      success: true,
      data: { commitShas: ['x'], changedFiles: [], commitMessage: 'fix' },
    });

    const result = await runVerificationLoop(baseInput as never);

    expect(result.success).toBe(false);
    expect(planningMocks.transitionTaskWorkflow).toHaveBeenCalledWith({
      taskId: 'task-1',
      event: { type: 'task.failed' },
    });
  });

  it('当 fix agent 失败时，直接 fire task.failed', async () => {
    verificationGateMock.runVerificationGate.mockResolvedValue(
      failedGateOutput,
    );
    agentRuntimeMock.runTaskAgentTurn.mockResolvedValue({
      success: false,
      error: 'agent error',
    });

    const result = await runVerificationLoop(baseInput as never);

    expect(result.success).toBe(false);
    expect(planningMocks.transitionTaskWorkflow).toHaveBeenCalledWith({
      taskId: 'task-1',
      event: { type: 'task.failed' },
    });
  });

  it('记录每次验证结果为 artifact', async () => {
    verificationGateMock.runVerificationGate.mockResolvedValue(
      passedGateOutput,
    );

    await runVerificationLoop(baseInput as never);

    expect(planningMocks.recordTaskAgentResult).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        agentId: 'verifier',
        runtimeId: 'system',
        metadata: expect.objectContaining({ kind: 'verification_report' }),
      }),
    );
  });
});
