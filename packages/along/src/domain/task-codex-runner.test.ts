// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: legacy runner tests use large shared mock setup.
// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: legacy runner test file predates current file-size rule.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const planningMocks = vi.hoisted(() => ({
  ensureTaskAgentBinding: vi.fn(),
  createTaskAgentRun: vi.fn(),
  finishTaskAgentRun: vi.fn(),
  recordTaskAgentProgress: vi.fn(),
  recordTaskAgentSessionEvent: vi.fn(),
  recordTaskAgentResult: vi.fn(),
  updateTaskAgentProviderSession: vi.fn(),
}));
const attachmentMocks = vi.hoisted(() => ({
  resolveInputImageAttachments: vi.fn(),
}));

vi.mock('./task-planning', () => ({
  AGENT_RUN_STATUS: {
    RUNNING: 'running',
    SUCCEEDED: 'succeeded',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
  },
  ensureTaskAgentBinding: planningMocks.ensureTaskAgentBinding,
  createTaskAgentRun: planningMocks.createTaskAgentRun,
  finishTaskAgentRun: planningMocks.finishTaskAgentRun,
  recordTaskAgentProgress: planningMocks.recordTaskAgentProgress,
  recordTaskAgentSessionEvent: planningMocks.recordTaskAgentSessionEvent,
  recordTaskAgentResult: planningMocks.recordTaskAgentResult,
  TASK_AGENT_PROGRESS_PHASE: {
    STARTING: 'starting',
    CONTEXT: 'context',
    TOOL: 'tool',
    WAITING: 'waiting',
    VERIFYING: 'verifying',
    FINALIZING: 'finalizing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
  },
  updateTaskAgentProviderSession: planningMocks.updateTaskAgentProviderSession,
}));

vi.mock('./task-attachment-read', () => ({
  resolveInputImageAttachments: attachmentMocks.resolveInputImageAttachments,
}));

import { runTaskCodexTurn } from './task-codex-runner';

describe('task-codex-runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    attachmentMocks.resolveInputImageAttachments.mockReturnValue({
      success: true,
      data: [],
    });
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
    planningMocks.recordTaskAgentProgress.mockReturnValue({
      success: true,
      data: {
        progressId: 'prog-1',
        runId: 'run-1',
        taskId: 'task-1',
        threadId: 'thread-1',
        agentId: 'planner',
        provider: 'codex',
        phase: 'starting',
        summary: 'Agent 已启动，正在创建 Codex thread。',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    planningMocks.recordTaskAgentSessionEvent.mockReturnValue({
      success: true,
      data: {
        eventId: 'sess-1',
        runId: 'run-1',
        taskId: 'task-1',
        threadId: 'thread-1',
        agentId: 'planner',
        provider: 'codex',
        source: 'system',
        kind: 'progress',
        content: 'Agent 已启动，正在创建 Codex thread。',
        metadata: {},
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    planningMocks.updateTaskAgentProviderSession.mockReturnValue({
      success: true,
      data: undefined,
    });
  });

  it('当输入 artifact 包含图片时，期望 Codex 收到 text 和 local_image', async () => {
    attachmentMocks.resolveInputImageAttachments.mockReturnValueOnce({
      success: true,
      data: [
        {
          attachmentId: 'att-1',
          originalName: 'screen.png',
          mimeType: 'image/png',
          absolutePath: '/tmp/screen.png',
        },
      ],
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
      prompt: '看图生成计划',
      cwd: '/tmp/project',
      createClient: () => client,
      inputArtifactIds: ['art-user'],
    });

    expect(result.success).toBe(true);
    expect(thread.run).toHaveBeenCalledWith(
      [
        { type: 'text', text: '看图生成计划' },
        { type: 'local_image', path: '/tmp/screen.png' },
      ],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(planningMocks.recordTaskAgentSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          type: 'input_images',
          count: 1,
          files: ['screen.png'],
        }),
      }),
    );
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
    expect(thread.run).toHaveBeenCalledWith(
      '生成计划',
      expect.objectContaining({
        outputSchema: { type: 'object' },
        signal: expect.any(AbortSignal),
      }),
    );
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

  it('当 Codex thread 执行失败但已有 session 时，期望保存 session 供下次恢复', async () => {
    const thread = {
      id: 'codex-thread-failed',
      run: vi.fn().mockRejectedValue(new Error('provider unavailable')),
    };
    const client = {
      startThread: vi.fn().mockReturnValue(thread),
      resumeThread: vi.fn(),
    };

    const result = await runTaskCodexTurn({
      taskId: 'task-1',
      threadId: 'thread-1',
      agentId: 'implementer',
      prompt: '继续实现',
      cwd: '/tmp/project',
      createClient: () => client,
    });

    expect(result.success).toBe(false);
    expect(planningMocks.updateTaskAgentProviderSession).toHaveBeenCalledWith(
      'thread-1',
      'implementer',
      'codex',
      'codex-thread-failed',
    );
    expect(planningMocks.finishTaskAgentRun).toHaveBeenCalledWith({
      runId: 'run-1',
      status: 'failed',
      providerSessionIdAtEnd: 'codex-thread-failed',
      error: 'provider unavailable',
    });
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

  it('当 Codex turn 超时时，期望中止执行并标记 run 失败', async () => {
    vi.useFakeTimers();
    const previousTimeout = process.env.ALONG_TASK_AGENT_TIMEOUT_MS;
    process.env.ALONG_TASK_AGENT_TIMEOUT_MS = '1';

    try {
      const thread = {
        id: 'codex-thread-1',
        run: vi.fn(
          (
            _prompt: string,
            options?: { outputSchema?: unknown; signal?: AbortSignal },
          ) =>
            new Promise<never>((_resolve, reject) => {
              options?.signal?.addEventListener('abort', () => {
                reject(new Error('aborted'));
              });
            }),
        ),
      };
      const client = {
        startThread: vi.fn().mockReturnValue(thread),
        resumeThread: vi.fn(),
      };

      const pending = runTaskCodexTurn({
        taskId: 'task-1',
        threadId: 'thread-1',
        agentId: 'implementer',
        prompt: '实现',
        cwd: '/tmp/project',
        createClient: () => client,
      });

      await vi.advanceTimersByTimeAsync(1);
      const result = await pending;

      expect(result.success).toBe(false);
      expect(planningMocks.finishTaskAgentRun).toHaveBeenCalledWith({
        runId: 'run-1',
        status: 'failed',
        providerSessionIdAtEnd: 'codex-thread-1',
        error: 'Codex Agent 执行超时（超过 1 ms）',
      });
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.ALONG_TASK_AGENT_TIMEOUT_MS;
      } else {
        process.env.ALONG_TASK_AGENT_TIMEOUT_MS = previousTimeout;
      }
      vi.useRealTimers();
    }
  });
});
