import { describe, expect, it, vi } from 'vitest';
import type { RegistryConfig } from '../../domain/registry/config';

vi.mock('../runtimes/codex/runtime-runner', () => ({
  CodexRuntimeRunner: {
    runAgentTurn: vi.fn(),
  },
}));

import { RuntimeService } from './runtime-service';

function createRegistry(): RegistryConfig {
  return {
    providers: [
      {
        id: 'openai',
        kind: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
      },
    ],
    models: [
      {
        id: 'model',
        providerId: 'openai',
        model: 'gpt-5.2',
        token: 'secret',
      },
    ],
    runtimes: [{ id: 'codex', kind: 'codex', modelId: 'model' }],
    agents: [{ id: 'planning', runtimeId: 'codex' }],
    profiles: [],
  };
}

describe('runtime-service', () => {
  it('registry 中 Codex agent 调用 Codex runtime runner', async () => {
    const runCodexAgentTurn = vi.fn().mockResolvedValue({
      success: true,
      data: {
        run: {
          runId: 'run-1',
          taskId: 'task-1',
          threadId: 'thread-1',
          agentId: 'planning',
          runtimeId: 'codex',
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

    const result = await RuntimeService.runAgentTurn(
      {
        taskId: 'task-1',
        threadId: 'thread-1',
        agentId: 'planning',
        prompt: 'hello',
        cwd: '/tmp/project',
      },
      {
        readRegistry: () => ({ success: true, data: createRegistry() }),
        runCodexAgentTurn,
      },
    );

    expect(result.success).toBe(true);
    expect(runCodexAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'planning',
        apiKey: 'secret',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.2',
      }),
    );
  });

  it('未知 agent 时不进入 runtime 分发', async () => {
    const runCodexAgentTurn = vi.fn();

    const result = await RuntimeService.runAgentTurn(
      {
        taskId: 'task-1',
        threadId: 'thread-1',
        agentId: 'missing',
        prompt: 'hello',
        cwd: '/tmp/project',
      },
      {
        readRegistry: () => ({ success: true, data: createRegistry() }),
        runCodexAgentTurn,
      },
    );

    expect(result.success).toBe(false);
    expect(runCodexAgentTurn).not.toHaveBeenCalled();
  });
});
