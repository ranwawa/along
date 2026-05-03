import { beforeEach, describe, expect, it, vi } from 'vitest';

const planningMocks = vi.hoisted(() => ({
  ensureTaskAgentBinding: vi.fn(),
  createTaskAgentRun: vi.fn(),
  finishTaskAgentRun: vi.fn(),
  recordTaskAgentResult: vi.fn(),
  updateTaskAgentProviderSession: vi.fn(),
}));

vi.mock('./task-planning', () => ({
  AGENT_RUN_STATUS: {
    RUNNING: 'running',
    SUCCEEDED: 'succeeded',
    FAILED: 'failed',
  },
  ensureTaskAgentBinding: planningMocks.ensureTaskAgentBinding,
  createTaskAgentRun: planningMocks.createTaskAgentRun,
  finishTaskAgentRun: planningMocks.finishTaskAgentRun,
  recordTaskAgentResult: planningMocks.recordTaskAgentResult,
  updateTaskAgentProviderSession: planningMocks.updateTaskAgentProviderSession,
}));

import { runTaskCodexTurn } from './task-codex-runner';

describe('task-codex-runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    planningMocks.ensureTaskAgentBinding.mockReturnValue({
      success: true,
      data: {
        threadId: 'thread-1',
        agentId: 'planner',
        provider: 'codex',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    planningMocks.createTaskAgentRun.mockReturnValue({
      success: true,
      data: {
        runId: 'run-1',
        taskId: 'task-1',
        threadId: 'thread-1',
        agentId: 'planner',
        provider: 'codex',
        status: 'running',
        inputArtifactIds: [],
        outputArtifactIds: [],
        startedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    planningMocks.finishTaskAgentRun.mockReturnValue({
      success: true,
      data: {
        runId: 'run-1',
        taskId: 'task-1',
        threadId: 'thread-1',
        agentId: 'planner',
        provider: 'codex',
        status: 'succeeded',
        inputArtifactIds: [],
        outputArtifactIds: ['art-result'],
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-01T00:00:01.000Z',
      },
    });
    planningMocks.recordTaskAgentResult.mockReturnValue({
      success: true,
      data: {
        artifactId: 'art-result',
        taskId: 'task-1',
        threadId: 'thread-1',
        type: 'agent_result',
        role: 'agent',
        body: '{"action":"plan_revision","body":"计划"}',
        metadata: {},
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    });
    planningMocks.updateTaskAgentProviderSession.mockReturnValue({
      success: true,
      data: undefined,
    });
  });

  it('使用 Codex SDK 新建 thread 并保存结构化输出', async () => {
    const thread = {
      id: 'codex-thread-1',
      run: vi.fn().mockResolvedValue({
        finalResponse: '{"action":"plan_revision","body":"计划"}',
        items: [],
        usage: null,
      }),
    };
    const client = {
      startThread: vi.fn().mockReturnValue(thread),
      resumeThread: vi.fn(),
    };

    const result = await runTaskCodexTurn({
      taskId: 'task-1',
      threadId: 'thread-1',
      agentId: 'planner',
      prompt: '生成计划',
      cwd: '/tmp/project',
      model: 'gpt-5.2',
      createClient: () => client,
      options: {
        outputFormat: {
          type: 'json_schema',
          schema: { type: 'object' },
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(client.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.2',
        workingDirectory: '/tmp/project',
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
      }),
    );
    expect(thread.run).toHaveBeenCalledWith('生成计划', {
      outputSchema: { type: 'object' },
    });
    expect(result.data.providerSessionId).toBe('codex-thread-1');
    expect(result.data.structuredOutput).toEqual({
      action: 'plan_revision',
      body: '计划',
    });
    expect(planningMocks.updateTaskAgentProviderSession).toHaveBeenCalledWith(
      'thread-1',
      'planner',
      'codex',
      'codex-thread-1',
    );
  });

  it('存在 provider session 时恢复 Codex thread', async () => {
    planningMocks.ensureTaskAgentBinding.mockReturnValueOnce({
      success: true,
      data: {
        threadId: 'thread-1',
        agentId: 'planner',
        provider: 'codex',
        providerSessionId: 'codex-thread-old',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    const thread = {
      id: 'codex-thread-old',
      run: vi.fn().mockResolvedValue({
        finalResponse: '完成',
        items: [],
        usage: null,
      }),
    };
    const client = {
      startThread: vi.fn(),
      resumeThread: vi.fn().mockReturnValue(thread),
    };

    const result = await runTaskCodexTurn({
      taskId: 'task-1',
      threadId: 'thread-1',
      agentId: 'planner',
      prompt: '继续',
      cwd: '/tmp/project',
      createClient: () => client,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.usedResume).toBe(true);
    expect(client.resumeThread).toHaveBeenCalledWith(
      'codex-thread-old',
      expect.objectContaining({ workingDirectory: '/tmp/project' }),
    );
  });

  it('当 Codex client 创建失败时，期望 run 被标记为失败', async () => {
    const result = await runTaskCodexTurn({
      taskId: 'task-1',
      threadId: 'thread-1',
      agentId: 'planner',
      prompt: '生成计划',
      cwd: '/tmp/project',
      createClient: () => {
        throw new Error('Unable to locate Codex CLI binaries');
      },
    });

    expect(result.success).toBe(false);
    expect(planningMocks.finishTaskAgentRun).toHaveBeenCalledWith({
      runId: 'run-1',
      status: 'failed',
      providerSessionIdAtEnd: undefined,
      error: 'Unable to locate Codex CLI binaries',
    });
  });

  it('当 provider session 更新失败时，期望 run 被标记为失败', async () => {
    planningMocks.updateTaskAgentProviderSession.mockReturnValueOnce({
      success: false,
      error: '更新 provider session 失败',
    });
    const thread = {
      id: 'codex-thread-1',
      run: vi.fn().mockResolvedValue({
        finalResponse: '完成',
        items: [],
        usage: null,
      }),
    };
    const client = {
      startThread: vi.fn().mockReturnValue(thread),
      resumeThread: vi.fn(),
    };

    const result = await runTaskCodexTurn({
      taskId: 'task-1',
      threadId: 'thread-1',
      agentId: 'planner',
      prompt: '生成计划',
      cwd: '/tmp/project',
      createClient: () => client,
    });

    expect(result.success).toBe(false);
    expect(planningMocks.finishTaskAgentRun).toHaveBeenCalledWith({
      runId: 'run-1',
      status: 'failed',
      providerSessionIdAtEnd: 'codex-thread-1',
      error: '更新 provider session 失败',
    });
  });
});
