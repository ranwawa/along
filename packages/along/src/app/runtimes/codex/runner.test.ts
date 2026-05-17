import type { ThreadEvent } from '@openai/codex-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const planningMocks = vi.hoisted(() => ({
  ensureTaskAgentBinding: vi.fn(),
  createTaskAgentRun: vi.fn(),
  finishTaskAgentRun: vi.fn(),
  readTaskAgentRun: vi.fn(),
  recordTaskAgentProgress: vi.fn(),
  recordTaskAgentSessionEvent: vi.fn(),
  recordTaskAgentResult: vi.fn(),
  updateTaskAgentRuntimeSession: vi.fn(),
}));
const attachmentMocks = vi.hoisted(() => ({
  resolveInputImageAttachments: vi.fn(),
}));

vi.mock('../../planning', () => ({
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
  updateTaskAgentRuntimeSession: planningMocks.updateTaskAgentRuntimeSession,
}));

vi.mock('../../task/attachment-read', () => ({
  resolveInputImageAttachments: attachmentMocks.resolveInputImageAttachments,
}));

import { requestTaskAgentCancellation } from '../../task/agent-run-lifecycle';
import { runTaskCodexTurn } from './runner';

async function* streamEvents(
  events: ThreadEvent[],
): AsyncGenerator<ThreadEvent> {
  for (const event of events) yield event;
}

function makeCompletedStream(
  threadId: string,
  text: string,
  usage = {
    input_tokens: 1,
    cached_input_tokens: 0,
    output_tokens: 1,
    reasoning_output_tokens: 0,
  },
): ThreadEvent[] {
  return [
    { type: 'thread.started', thread_id: threadId },
    { type: 'turn.started' },
    {
      type: 'item.completed',
      item: { id: 'msg-1', type: 'agent_message', text },
    },
    { type: 'turn.completed', usage },
  ];
}

describe('codex/runner', () => {
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
        runtimeId: 'codex',
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
        runtimeId: 'codex',
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
        runtimeId: 'codex',
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
        agentId: 'planner',
        runtimeId: 'codex',
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
        runtimeId: 'codex',
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
        runtimeId: 'codex',
        source: 'system',
        kind: 'progress',
        content: 'Agent 已启动，正在创建 Codex thread。',
        metadata: {},
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    planningMocks.updateTaskAgentRuntimeSession.mockReturnValue({
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
      runStreamed: vi.fn().mockResolvedValue({
        events: streamEvents(makeCompletedStream('codex-thread-1', '完成')),
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
    expect(thread.runStreamed).toHaveBeenCalledWith(
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
      runStreamed: vi.fn().mockResolvedValue({
        events: streamEvents(
          makeCompletedStream(
            'codex-thread-1',
            '{"action":"plan_revision","body":"计划"}',
          ),
        ),
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
    expect(thread.runStreamed).toHaveBeenCalledWith(
      '生成计划',
      expect.objectContaining({
        outputSchema: { type: 'object' },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result.data.runtimeSessionId).toBe('codex-thread-1');
    expect(result.data.structuredOutput).toEqual({
      action: 'plan_revision',
      body: '计划',
    });
    expect(planningMocks.updateTaskAgentRuntimeSession).toHaveBeenCalledWith(
      'thread-1',
      'planner',
      'codex',
      'codex-thread-1',
    );
  });

  it('消费 runStreamed 事件并把 Codex 实时输出写入会话 Tail', async () => {
    const thread = {
      id: 'codex-thread-1',
      runStreamed: vi.fn().mockResolvedValue({
        events: streamEvents([
          { type: 'thread.started', thread_id: 'codex-thread-1' },
          { type: 'turn.started' },
          {
            type: 'item.started',
            item: {
              id: 'cmd-1',
              type: 'command_execution',
              command: 'bun test',
              aggregated_output: '',
              status: 'in_progress',
            },
          },
          {
            type: 'item.updated',
            item: {
              id: 'cmd-1',
              type: 'command_execution',
              command: 'bun test',
              aggregated_output: 'pass',
              status: 'in_progress',
            },
          },
          {
            type: 'item.updated',
            item: {
              id: 'cmd-1',
              type: 'command_execution',
              command: 'bun test',
              aggregated_output: 'pass\nall',
              status: 'in_progress',
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'cmd-1',
              type: 'command_execution',
              command: 'bun test',
              aggregated_output: 'pass\nall',
              status: 'completed',
              exit_code: 0,
            },
          },
          {
            type: 'item.updated',
            item: { id: 'msg-1', type: 'agent_message', text: '完成' },
          },
          {
            type: 'item.updated',
            item: { id: 'msg-1', type: 'agent_message', text: '完成实现' },
          },
          {
            type: 'item.completed',
            item: { id: 'msg-1', type: 'agent_message', text: '完成实现' },
          },
          {
            type: 'turn.completed',
            usage: {
              input_tokens: 10,
              cached_input_tokens: 1,
              output_tokens: 5,
              reasoning_output_tokens: 2,
            },
          },
        ]),
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

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.assistantText).toBe('完成实现');
    expect(planningMocks.recordTaskAgentProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'waiting',
        summary: 'Codex 已开始处理本轮请求。',
      }),
    );
    expect(planningMocks.recordTaskAgentSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'system',
        kind: 'message',
        content: 'Codex thread 已连接。',
        metadata: expect.objectContaining({
          provider_event_type: 'thread.started',
          thread_id: 'codex-thread-1',
        }),
      }),
    );
    expect(planningMocks.recordTaskAgentSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'stdout',
        kind: 'output',
        content: 'pass',
        metadata: expect.objectContaining({
          provider_event_type: 'item.updated',
          item_id: 'cmd-1',
          delta_mode: 'delta',
        }),
      }),
    );
    expect(planningMocks.recordTaskAgentSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'stdout',
        kind: 'output',
        content: '\nall',
      }),
    );
    expect(planningMocks.recordTaskAgentSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'agent',
        kind: 'output',
        content: '实现',
        metadata: expect.objectContaining({
          provider_event_type: 'item.updated',
          item_type: 'agent_message',
          delta_mode: 'delta',
        }),
      }),
    );
    expect(planningMocks.recordTaskAgentSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Codex turn 已完成。',
        metadata: expect.objectContaining({
          provider_event_type: 'turn.completed',
          usage: expect.objectContaining({ input_tokens: 10 }),
        }),
      }),
    );
  });

  it('当 item.updated 不是前缀增长时写 snapshot 并标记 metadata', async () => {
    const thread = {
      id: 'codex-thread-1',
      runStreamed: vi.fn().mockResolvedValue({
        events: streamEvents([
          { type: 'thread.started', thread_id: 'codex-thread-1' },
          { type: 'turn.started' },
          {
            type: 'item.updated',
            item: { id: 'msg-1', type: 'agent_message', text: '旧内容' },
          },
          {
            type: 'item.updated',
            item: { id: 'msg-1', type: 'agent_message', text: '重排后内容' },
          },
          {
            type: 'item.completed',
            item: { id: 'msg-1', type: 'agent_message', text: '重排后内容' },
          },
          {
            type: 'turn.completed',
            usage: {
              input_tokens: 1,
              cached_input_tokens: 0,
              output_tokens: 1,
              reasoning_output_tokens: 0,
            },
          },
        ]),
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

    expect(result.success).toBe(true);
    expect(planningMocks.recordTaskAgentSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'agent',
        kind: 'output',
        content: '重排后内容',
        metadata: expect.objectContaining({
          provider_event_type: 'item.updated',
          item_id: 'msg-1',
          delta_mode: 'snapshot',
        }),
      }),
    );
  });

  it('当 Codex stream 返回 turn.failed 时写 Tail 错误并标记 run 失败', async () => {
    const thread = {
      id: 'codex-thread-1',
      runStreamed: vi.fn().mockResolvedValue({
        events: streamEvents([
          { type: 'thread.started', thread_id: 'codex-thread-1' },
          {
            type: 'turn.failed',
            error: { message: 'Codex unavailable' },
          },
        ]),
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
    expect(planningMocks.recordTaskAgentSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'system',
        kind: 'error',
        content: 'Codex turn 失败：Codex unavailable',
        metadata: expect.objectContaining({
          provider_event_type: 'turn.failed',
        }),
      }),
    );
    expect(planningMocks.finishTaskAgentRun).toHaveBeenCalledWith({
      runId: 'run-1',
      status: 'failed',
      runtimeSessionIdAtEnd: 'codex-thread-1',
      error: 'Codex unavailable',
    });
  });

  it('当 Codex stream 返回 error 时写 Tail 错误并标记 run 失败', async () => {
    const thread = {
      id: 'codex-thread-1',
      runStreamed: vi.fn().mockResolvedValue({
        events: streamEvents([
          { type: 'thread.started', thread_id: 'codex-thread-1' },
          {
            type: 'error',
            message: 'stream disconnected',
          },
        ]),
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
    expect(planningMocks.recordTaskAgentSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'system',
        kind: 'error',
        content: 'Codex stream 错误：stream disconnected',
        metadata: expect.objectContaining({
          provider_event_type: 'error',
        }),
      }),
    );
    expect(planningMocks.finishTaskAgentRun).toHaveBeenCalledWith({
      runId: 'run-1',
      status: 'failed',
      runtimeSessionIdAtEnd: 'codex-thread-1',
      error: 'stream disconnected',
    });
  });

  it('当 Codex stream 返回可恢复重连错误时继续消费后续事件', async () => {
    const thread = {
      id: 'codex-thread-1',
      runStreamed: vi.fn().mockResolvedValue({
        events: streamEvents([
          { type: 'thread.started', thread_id: 'codex-thread-1' },
          { type: 'turn.started' },
          {
            type: 'error',
            message:
              'Reconnecting... 2/5 (stream disconnected before completion: tls handshake eof)',
          },
          {
            type: 'item.completed',
            item: { id: 'msg-1', type: 'agent_message', text: '恢复完成' },
          },
          {
            type: 'turn.completed',
            usage: {
              input_tokens: 1,
              cached_input_tokens: 0,
              output_tokens: 1,
              reasoning_output_tokens: 0,
            },
          },
        ]),
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

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.assistantText).toBe('恢复完成');
    expect(planningMocks.recordTaskAgentSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'system',
        kind: 'error',
        content:
          'Codex stream 错误：Reconnecting... 2/5 (stream disconnected before completion: tls handshake eof)',
        metadata: expect.objectContaining({
          provider_event_type: 'error',
        }),
      }),
    );
    expect(planningMocks.finishTaskAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'succeeded',
        runtimeSessionIdAtEnd: 'codex-thread-1',
      }),
    );
  });

  it('当 Codex stream 重连后未完成就结束时仍标记 run 失败', async () => {
    const errorMessage =
      'Reconnecting... 5/5 (stream disconnected before completion: tls handshake eof)';
    const thread = {
      id: 'codex-thread-1',
      runStreamed: vi.fn().mockResolvedValue({
        events: streamEvents([
          { type: 'thread.started', thread_id: 'codex-thread-1' },
          { type: 'turn.started' },
          {
            type: 'error',
            message: errorMessage,
          },
        ]),
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
      runtimeSessionIdAtEnd: 'codex-thread-1',
      error: errorMessage,
    });
  });

  it('存在 Codex session 时恢复 Codex thread', async () => {
    planningMocks.ensureTaskAgentBinding.mockReturnValueOnce({
      success: true,
      data: {
        threadId: 'thread-1',
        agentId: 'planner',
        runtimeId: 'codex',
        runtimeSessionId: 'codex-thread-old',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    const thread = {
      id: 'codex-thread-old',
      runStreamed: vi.fn().mockResolvedValue({
        events: streamEvents(makeCompletedStream('codex-thread-old', '完成')),
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
      runStreamed: vi.fn().mockRejectedValue(new Error('Codex unavailable')),
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
    expect(planningMocks.updateTaskAgentRuntimeSession).toHaveBeenCalledWith(
      'thread-1',
      'implementer',
      'codex',
      'codex-thread-failed',
    );
    expect(planningMocks.finishTaskAgentRun).toHaveBeenCalledWith({
      runId: 'run-1',
      status: 'failed',
      runtimeSessionIdAtEnd: 'codex-thread-failed',
      error: 'Codex unavailable',
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
      runtimeSessionIdAtEnd: undefined,
      error: 'Unable to locate Codex CLI binaries',
    });
  });

  it('当 Codex session 更新失败时，期望 run 被标记为失败', async () => {
    planningMocks.updateTaskAgentRuntimeSession.mockReturnValueOnce({
      success: false,
      error: '更新 Codex session 失败',
    });
    const thread = {
      id: 'codex-thread-1',
      runStreamed: vi.fn().mockResolvedValue({
        events: streamEvents(makeCompletedStream('codex-thread-1', '完成')),
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
      runtimeSessionIdAtEnd: 'codex-thread-1',
      error: '更新 Codex session 失败',
    });
  });

  it('当 Codex turn 超时时，期望中止执行并标记 run 失败', async () => {
    vi.useFakeTimers();
    const previousTimeout = process.env.ALONG_TASK_AGENT_TIMEOUT_MS;
    process.env.ALONG_TASK_AGENT_TIMEOUT_MS = '1';

    try {
      const thread = {
        id: 'codex-thread-1',
        runStreamed: vi.fn(
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
        runtimeSessionIdAtEnd: 'codex-thread-1',
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

  it('当用户取消 Codex turn 时，期望中止执行且不保存输出', async () => {
    let aborted = false;
    let resolveStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const thread = {
      id: 'codex-thread-1',
      runStreamed: vi.fn(
        (
          _prompt: string,
          options?: { outputSchema?: unknown; signal?: AbortSignal },
        ) =>
          new Promise<never>((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => {
              aborted = true;
              planningMocks.readTaskAgentRun.mockReturnValue({
                success: true,
                data: {
                  runId: 'run-1',
                  taskId: 'task-1',
                  threadId: 'thread-1',
                  agentId: 'planner',
                  runtimeId: 'codex',
                  status: 'cancelled',
                  inputArtifactIds: [],
                  outputArtifactIds: [],
                  startedAt: '2026-01-01T00:00:00.000Z',
                  endedAt: '2026-01-01T00:00:01.000Z',
                },
              });
              reject(new Error('aborted'));
            });
            resolveStarted();
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
      agentId: 'planner',
      prompt: '生成计划',
      cwd: '/tmp/project',
      createClient: () => client,
    });
    await started;
    requestTaskAgentCancellation('run-1', 'user cancelled');
    const result = await pending;

    expect(result.success).toBe(true);
    expect(aborted).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.run.status).toBe('cancelled');
    expect(result.data.assistantText).toBe('');
    expect(planningMocks.recordTaskAgentResult).not.toHaveBeenCalled();
  });
});
