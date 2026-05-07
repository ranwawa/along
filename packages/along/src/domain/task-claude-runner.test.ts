// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: legacy runner tests use large shared mock setup.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
const attachmentMocks = vi.hoisted(() => ({
  resolveInputImageAttachments: vi.fn(),
}));
const planningMocks = vi.hoisted(() => ({
  ensureTaskAgentBinding: vi.fn(),
  createTaskAgentRun: vi.fn(),
  finishTaskAgentRun: vi.fn(),
  recordTaskAgentProgress: vi.fn(),
  recordTaskAgentSessionEvent: vi.fn(),
  recordTaskAgentResult: vi.fn(),
  updateTaskAgentProviderSession: vi.fn(),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
}));

vi.mock('./task-attachment-read', () => ({
  resolveInputImageAttachments: attachmentMocks.resolveInputImageAttachments,
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

import { runTaskClaudeTurn } from './task-claude-runner';

function successfulConversation(sessionId: string) {
  return (async function* () {
    yield { type: 'system', session_id: sessionId };
    yield {
      type: 'assistant',
      session_id: sessionId,
      message: { content: [{ type: 'text', text: '中间输出' }] },
    };
    yield {
      type: 'result',
      subtype: 'success',
      result: '最终计划 JSON',
      structured_output: {
        action: 'plan_revision',
        body: '最终计划',
      },
    };
  })();
}

function errorConversation(sessionId: string) {
  return (async function* () {
    yield { type: 'system', session_id: sessionId };
    yield { type: 'result', is_error: true, errors: ['模型执行失败'] };
  })();
}

describe('task-claude-runner', () => {
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
        provider: 'claude',
        providerSessionId: 'session-1',
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
        provider: 'claude',
        providerSessionIdAtStart: 'session-1',
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
        provider: 'claude',
        providerSessionIdAtStart: 'session-1',
        providerSessionIdAtEnd: 'session-2',
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
        body: '最终计划 JSON',
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
        provider: 'claude',
        phase: 'starting',
        summary: 'Agent 已启动，正在准备任务上下文。',
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
        provider: 'claude',
        source: 'system',
        kind: 'progress',
        content: 'Agent 已启动，正在准备任务上下文。',
        metadata: {},
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    planningMocks.updateTaskAgentProviderSession.mockReturnValue({
      success: true,
      data: undefined,
    });
    queryMock.mockReturnValue(successfulConversation('session-2'));
  });

  it('当输入 artifact 包含图片时，期望 Claude 收到图文 SDKUserMessage', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'along-claude-'));
    const imagePath = path.join(tempDir, 'screen.png');
    writeFileSync(imagePath, 'fake-image');
    attachmentMocks.resolveInputImageAttachments.mockReturnValueOnce({
      success: true,
      data: [
        {
          attachmentId: 'att-1',
          originalName: 'screen.png',
          mimeType: 'image/png',
          absolutePath: imagePath,
        },
      ],
    });

    try {
      const result = await runTaskClaudeTurn({
        taskId: 'task-1',
        threadId: 'thread-1',
        agentId: 'planner',
        prompt: '看图生成计划',
        cwd: '/tmp/project',
        inputArtifactIds: ['art-user'],
      });

      expect(result.success).toBe(true);
      const prompt = queryMock.mock.calls[0]?.[0]?.prompt;
      const messages = [];
      for await (const message of prompt) messages.push(message);
      expect(messages[0]).toMatchObject({
        type: 'user',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            { type: 'text', text: '看图生成计划' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: Buffer.from('fake-image').toString('base64'),
              },
            },
          ],
        },
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('当存在 provider session 时，期望下一轮 Claude 调用使用 resume', async () => {
    const result = await runTaskClaudeTurn({
      taskId: 'task-1',
      threadId: 'thread-1',
      agentId: 'planner',
      prompt: '继续处理用户反馈',
      cwd: '/tmp/project',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.usedResume).toBe(true);
    expect(result.data.providerSessionId).toBe('session-2');
    expect(result.data.assistantText).toBe('最终计划 JSON');
    expect(result.data.structuredOutput).toEqual({
      action: 'plan_revision',
      body: '最终计划',
    });
    expect(result.data.outputArtifactIds).toEqual(['art-result']);
    expect(queryMock).toHaveBeenCalledWith({
      prompt: '继续处理用户反馈',
      options: expect.objectContaining({
        cwd: '/tmp/project',
        resume: 'session-1',
        permissionMode: 'plan',
      }),
    });
    expect(planningMocks.updateTaskAgentProviderSession).toHaveBeenCalledWith(
      'thread-1',
      'planner',
      'claude',
      'session-2',
    );
    expect(planningMocks.recordTaskAgentResult).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        threadId: 'thread-1',
        agentId: 'planner',
        provider: 'claude',
        body: '最终计划 JSON',
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

  it('当没有 provider session 时，期望创建新 Claude 会话', async () => {
    planningMocks.ensureTaskAgentBinding.mockReturnValueOnce({
      success: true,
      data: {
        threadId: 'thread-1',
        agentId: 'planner',
        provider: 'claude',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    const result = await runTaskClaudeTurn({
      taskId: 'task-1',
      threadId: 'thread-1',
      agentId: 'planner',
      prompt: '生成首版计划',
      cwd: '/tmp/project',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.usedResume).toBe(false);
    expect(queryMock).toHaveBeenCalledWith({
      prompt: '生成首版计划',
      options: expect.objectContaining({
        cwd: '/tmp/project',
        resume: undefined,
      }),
    });
  });

  it('当 Claude 返回错误结果时，期望记录失败 run', async () => {
    queryMock.mockReturnValueOnce(errorConversation('session-2'));

    const result = await runTaskClaudeTurn({
      taskId: 'task-1',
      threadId: 'thread-1',
      agentId: 'planner',
      prompt: '继续处理用户反馈',
      cwd: '/tmp/project',
    });

    expect(result.success).toBe(false);
    expect(planningMocks.updateTaskAgentProviderSession).toHaveBeenCalledWith(
      'thread-1',
      'planner',
      'claude',
      'session-2',
    );
    expect(planningMocks.finishTaskAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        status: 'failed',
        providerSessionIdAtEnd: 'session-2',
        error: '模型执行失败',
      }),
    );
  });
});
