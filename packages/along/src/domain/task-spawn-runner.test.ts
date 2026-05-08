// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: legacy runner tests use large shared mock setup.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const planningMocks = vi.hoisted(() => ({
  ensureTaskAgentBinding: vi.fn(),
  createTaskAgentRun: vi.fn(),
  finishTaskAgentRun: vi.fn(),
  readTaskAgentRun: vi.fn(),
  recordTaskAgentProgress: vi.fn(),
  recordTaskAgentSessionEvent: vi.fn(),
  recordTaskAgentResult: vi.fn(),
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
  readTaskAgentRun: planningMocks.readTaskAgentRun,
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
}));

vi.mock('./task-attachment-read', () => ({
  resolveInputImageAttachments: attachmentMocks.resolveInputImageAttachments,
}));

import { buildTaskSpawnCommand, runTaskSpawnTurn } from './task-spawn-runner';

describe('task-spawn-runner', () => {
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
        agentId: 'implementer',
        provider: 'pi',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    planningMocks.createTaskAgentRun.mockReturnValue({
      success: true,
      data: {
        runId: 'run-1',
        taskId: 'task-1',
        threadId: 'thread-1',
        agentId: 'implementer',
        provider: 'pi',
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
        agentId: 'implementer',
        provider: 'pi',
        status: 'succeeded',
        inputArtifactIds: [],
        outputArtifactIds: ['art-result'],
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-01T00:00:01.000Z',
      },
    });
    planningMocks.readTaskAgentRun.mockReturnValue({
      success: true,
      data: {
        runId: 'run-1',
        taskId: 'task-1',
        threadId: 'thread-1',
        agentId: 'implementer',
        provider: 'pi',
        status: 'running',
        inputArtifactIds: [],
        outputArtifactIds: [],
        startedAt: '2026-01-01T00:00:00.000Z',
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
        body: '实现完成',
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
        agentId: 'implementer',
        provider: 'pi',
        phase: 'starting',
        summary: 'Agent 已启动，正在执行 PI。',
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
        agentId: 'implementer',
        provider: 'pi',
        source: 'system',
        kind: 'progress',
        content: 'Agent 已启动，正在执行 PI。',
        metadata: {},
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
  });

  it('当输入 artifact 包含图片时，期望外部 CLI prompt 包含图片路径', async () => {
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
    const spawnRunner = vi.fn().mockResolvedValue({
      success: true,
      data: { exitCode: 0, stdout: '完成', stderr: '' },
    });

    const result = await runTaskSpawnTurn({
      taskId: 'task-1',
      threadId: 'thread-1',
      agentId: 'implementer',
      editor: 'pi',
      prompt: '实现批准方案',
      cwd: '/tmp/project',
      inputArtifactIds: ['art-user'],
      spawnRunner,
    });

    expect(result.success).toBe(true);
    expect(spawnRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([
          expect.stringContaining(
            '用户上传图片路径：\n1. screen.png: /tmp/screen.png',
          ),
        ]),
      }),
    );
  });

  it('为 PI 构造非交互命令', () => {
    const result = buildTaskSpawnCommand({
      taskId: 'task-1',
      threadId: 'thread-1',
      agentId: 'implementer',
      editor: 'pi',
      prompt: '实现批准方案',
      cwd: '/tmp/project',
      model: 'gpt-5.2',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data).toEqual({
      command: 'pi',
      args: ['--print', '--model', 'gpt-5.2', '实现批准方案'],
      cwd: '/tmp/project',
    });
  });

  it('执行成功时记录 agent_result artifact 并完成 run', async () => {
    const spawnRunner = vi.fn().mockResolvedValue({
      success: true,
      data: { exitCode: 0, stdout: '实现完成', stderr: '' },
    });

    const result = await runTaskSpawnTurn({
      taskId: 'task-1',
      threadId: 'thread-1',
      agentId: 'implementer',
      editor: 'pi',
      prompt: '实现批准方案',
      cwd: '/tmp/project',
      spawnRunner,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(spawnRunner).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'pi' }),
    );
    expect(planningMocks.recordTaskAgentResult).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        threadId: 'thread-1',
        agentId: 'implementer',
        provider: 'pi',
        body: '实现完成',
      }),
    );
    expect(planningMocks.finishTaskAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        status: 'succeeded',
        outputArtifactIds: ['art-result'],
      }),
    );
  });

  it('CLI 退出码非 0 时记录失败 run', async () => {
    const spawnRunner = vi.fn().mockResolvedValue({
      success: true,
      data: { exitCode: 1, stdout: '', stderr: '认证失败' },
    });

    const result = await runTaskSpawnTurn({
      taskId: 'task-1',
      threadId: 'thread-1',
      agentId: 'implementer',
      editor: 'pi',
      prompt: '实现批准方案',
      cwd: '/tmp/project',
      spawnRunner,
    });

    expect(result.success).toBe(false);
    expect(planningMocks.finishTaskAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        status: 'failed',
        error: '认证失败',
      }),
    );
  });
});
