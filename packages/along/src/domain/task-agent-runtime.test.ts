import { beforeEach, describe, expect, it, vi } from 'vitest';

const configMocks = vi.hoisted(() => ({
  getTaskAgentConfig: vi.fn(),
}));
const codexRunnerMock = vi.hoisted(() => vi.fn());

vi.mock('../integration/agent-config', () => ({
  getTaskAgentConfig: configMocks.getTaskAgentConfig,
}));

vi.mock('./task-codex-runner', () => ({
  runTaskCodexTurn: codexRunnerMock,
}));

import {
  resolveTaskAgentRuntime,
  runTaskAgentTurn,
} from './task-agent-runtime';

describe('task-agent-runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMocks.getTaskAgentConfig.mockReturnValue(null);
    codexRunnerMock.mockResolvedValue({
      success: true,
      data: {
        run: {
          runId: 'run-1',
          taskId: 'task-1',
          threadId: 'thread-1',
          agentId: 'planner',
          provider: 'codex',
          status: 'succeeded',
          inputArtifactIds: [],
          outputArtifactIds: [],
          startedAt: '2026-01-01T00:00:00.000Z',
        },
        usedResume: false,
        assistantText: 'done',
        outputArtifactIds: [],
      },
    });
  });

  it('请求级配置优先于全局配置', () => {
    configMocks.getTaskAgentConfig.mockReturnValue({
      editor: 'codex',
      model: 'gpt-5.1',
    });

    expect(
      resolveTaskAgentRuntime({
        agentId: 'planner',
        editor: 'codex',
        model: 'gpt-5.2',
      }),
    ).toEqual({
      agentId: 'planner',
      editor: 'codex',
      model: 'gpt-5.2',
      personalityVersion: undefined,
    });
  });

  it('默认使用 Codex runner', async () => {
    const result = await runTaskAgentTurn({
      taskId: 'task-1',
      threadId: 'thread-1',
      agentId: 'planner',
      prompt: 'hello',
      cwd: '/tmp/project',
    });

    expect(result.success).toBe(true);
    expect(codexRunnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'planner',
        model: undefined,
      }),
    );
  });

  it('拒绝非 Codex editor', async () => {
    configMocks.getTaskAgentConfig.mockReturnValue({ editor: 'missing' });

    const result = await runTaskAgentTurn({
      taskId: 'task-1',
      threadId: 'thread-1',
      agentId: 'planner',
      prompt: 'hello',
      cwd: '/tmp/project',
    });

    expect(result.success).toBe(false);
    expect(codexRunnerMock).not.toHaveBeenCalled();
  });
});
