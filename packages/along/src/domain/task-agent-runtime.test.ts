import { beforeEach, describe, expect, it, vi } from 'vitest';

const configMocks = vi.hoisted(() => ({
  getTaskAgentConfig: vi.fn(),
}));
const claudeRunnerMock = vi.hoisted(() => vi.fn());
const codexRunnerMock = vi.hoisted(() => vi.fn());
const spawnRunnerMock = vi.hoisted(() => vi.fn());

vi.mock('../integration/agent-config', () => ({
  getTaskAgentConfig: configMocks.getTaskAgentConfig,
}));

vi.mock('./task-claude-runner', () => ({
  runTaskClaudeTurn: claudeRunnerMock,
}));

vi.mock('./task-codex-runner', () => ({
  runTaskCodexTurn: codexRunnerMock,
}));

vi.mock('./task-spawn-runner', () => ({
  runTaskSpawnTurn: spawnRunnerMock,
}));

import {
  resolveTaskAgentRuntime,
  runTaskAgentTurn,
} from './task-agent-runtime';

describe('task-agent-runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMocks.getTaskAgentConfig.mockReturnValue(null);
    claudeRunnerMock.mockResolvedValue({
      success: true,
      data: {
        run: {
          runId: 'run-1',
          taskId: 'task-1',
          threadId: 'thread-1',
          agentId: 'planner',
          provider: 'claude',
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
    spawnRunnerMock.mockResolvedValue({
      success: true,
      data: {
        run: {
          runId: 'run-1',
          taskId: 'task-1',
          threadId: 'thread-1',
          agentId: 'planner',
          provider: 'opencode',
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
      editor: 'claude',
      model: 'sonnet',
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

  it('默认使用 claude runner', async () => {
    const result = await runTaskAgentTurn({
      taskId: 'task-1',
      threadId: 'thread-1',
      agentId: 'planner',
      prompt: 'hello',
      cwd: '/tmp/project',
    });

    expect(result.success).toBe(true);
    expect(claudeRunnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'planner',
        model: undefined,
      }),
    );
  });

  it('codex editor 使用 Codex SDK runner', async () => {
    configMocks.getTaskAgentConfig.mockReturnValue({ editor: 'codex' });

    const result = await runTaskAgentTurn({
      taskId: 'task-1',
      threadId: 'thread-1',
      agentId: 'planner',
      prompt: 'hello',
      cwd: '/tmp/project',
    });

    expect(result.success).toBe(true);
    expect(claudeRunnerMock).not.toHaveBeenCalled();
    expect(codexRunnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'planner',
      }),
    );
    expect(spawnRunnerMock).not.toHaveBeenCalled();
  });

  it('其它 editor 使用 spawn runner', async () => {
    configMocks.getTaskAgentConfig.mockReturnValue({ editor: 'opencode' });

    const result = await runTaskAgentTurn({
      taskId: 'task-1',
      threadId: 'thread-1',
      agentId: 'planner',
      prompt: 'hello',
      cwd: '/tmp/project',
    });

    expect(result.success).toBe(true);
    expect(claudeRunnerMock).not.toHaveBeenCalled();
    expect(codexRunnerMock).not.toHaveBeenCalled();
    expect(spawnRunnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'planner',
        editor: 'opencode',
      }),
    );
  });
});
