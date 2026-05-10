import { beforeEach, describe, expect, it, vi } from 'vitest';

const planningMocks = vi.hoisted(() => ({
  readTaskPlanningSnapshot: vi.fn(),
  publishTaskPlanRevision: vi.fn(),
  publishPlanningUpdate: vi.fn(),
}));
const runnerMock = vi.hoisted(() => vi.fn());

vi.mock('./task-planning', () => ({
  TASK_LIFECYCLE: {
    CANCELLED: 'cancelled',
  },
  readTaskPlanningSnapshot: planningMocks.readTaskPlanningSnapshot,
  publishTaskPlanRevision: planningMocks.publishTaskPlanRevision,
  publishPlanningUpdate: planningMocks.publishPlanningUpdate,
}));

vi.mock('./task-agent-runtime', () => ({
  runTaskAgentTurn: runnerMock,
}));

import {
  parseTaskPlannerOutput,
  runTaskPlanningAgent,
} from './task-planning-agent';

const baseSnapshot = {
  task: {
    taskId: 'task-1',
    title: '实现 Task planning API',
    body: '需要不依赖 GitHub Issue 完成 planning。',
    source: 'test',
    status: 'planning',
    lifecycle: 'open',
    currentWorkflowKind: 'planning',
    activeThreadId: 'thread-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  thread: {
    threadId: 'thread-1',
    taskId: 'task-1',
    purpose: 'planning',
    status: 'drafting',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  currentPlan: null,
  openRound: null,
  artifacts: [
    {
      artifactId: 'art-user',
      taskId: 'task-1',
      threadId: 'thread-1',
      type: 'user_message',
      role: 'user',
      body: '需要不依赖 GitHub Issue 完成 planning。',
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  plans: [],
};

describe('task-planning-agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    planningMocks.readTaskPlanningSnapshot.mockReturnValue({
      success: true,
      data: baseSnapshot,
    });
    planningMocks.publishTaskPlanRevision.mockReturnValue({
      success: true,
      data: {
        planId: 'plan-1',
        taskId: 'task-1',
        threadId: 'thread-1',
        version: 1,
        status: 'active',
        artifactId: 'art-plan',
        body: '## 方案\n\n先做 API。',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    });
    planningMocks.publishPlanningUpdate.mockReturnValue({
      success: true,
      data: {
        artifactId: 'art-update',
        taskId: 'task-1',
        threadId: 'thread-1',
        type: 'planning_update',
        role: 'agent',
        body: '需要确认仓库。',
        metadata: {},
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    });
    runnerMock.mockResolvedValue({
      success: true,
      data: {
        run: {
          runId: 'run-1',
          taskId: 'task-1',
          threadId: 'thread-1',
          agentId: 'planner',
          provider: 'codex',
          status: 'succeeded',
          inputArtifactIds: ['art-user'],
          outputArtifactIds: ['art-result'],
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: '2026-01-01T00:00:01.000Z',
        },
        providerSessionId: 'session-1',
        usedResume: false,
        assistantText:
          '{"action":"plan_revision","body":"## 方案\\n\\n先做 API。"}',
        structuredOutput: {
          action: 'plan_revision',
          body: '## 方案\n\n先做 API。',
        },
        outputArtifactIds: ['art-result'],
      },
    });
  });

  it('当 Planner 输出 JSON 代码块时，期望解析出动作和正文', () => {
    const parsed = parseTaskPlannerOutput(
      '```json\n{"action":"planning_update","body":"需要确认仓库。"}\n```',
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error(parsed.error);
    expect(parsed.data).toEqual({
      action: 'planning_update',
      body: '需要确认仓库。',
    });
  });

  it('当 Planner 输出包含 type 字段时，期望解析出 type', () => {
    const parsed = parseTaskPlannerOutput(
      '{"action":"plan_revision","body":"## 方案","type":"feat"}',
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error(parsed.error);
    expect(parsed.data).toEqual({
      action: 'plan_revision',
      body: '## 方案',
      type: 'feat',
    });
  });

  it('当 Planner 输出缺少 JSON 时，期望返回失败', () => {
    const parsed = parseTaskPlannerOutput('这里是一段普通文本');

    expect(parsed.success).toBe(false);
  });

  it('当 Agent 返回正式计划时，期望发布 Task Plan Revision', async () => {
    const result = await runTaskPlanningAgent({
      taskId: 'task-1',
      cwd: '/tmp/project',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.action).toBe('plan_revision');
    expect(runnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        threadId: 'thread-1',
        agentId: 'planner',
        cwd: '/tmp/project',
        inputArtifactIds: ['art-user'],
        outputMetadata: expect.objectContaining({
          kind: 'planner_turn',
          nodePrompt: expect.objectContaining({
            name: 'planner',
            version: 'v1',
          }),
        }),
      }),
    );
    expect(planningMocks.publishTaskPlanRevision).toHaveBeenCalledWith({
      taskId: 'task-1',
      agentId: 'planner',
      body: '## 方案\n\n先做 API。',
      type: undefined,
      metadata: {
        kind: 'planner_contract',
        nodePrompt: {
          name: 'planner',
          version: 'v1',
        },
      },
    });
  });

  it('Planner prompt 包含价值判断、根因、架构、兼容性和可实施计划规则', async () => {
    const result = await runTaskPlanningAgent({
      taskId: 'task-1',
      cwd: '/tmp/project',
    });

    expect(result.success).toBe(true);
    const callInput = runnerMock.mock.calls[0]?.[0] as
      | { prompt?: string }
      | undefined;
    expect(callInput?.prompt).toContain('是否值得做');
    expect(callInput?.prompt).toContain('有权拒绝');
    expect(callInput?.prompt).toContain('定位根因');
    expect(callInput?.prompt).toContain('业务语义和架构合理性');
    expect(callInput?.prompt).toContain('不要主动设计向下兼容');
    expect(callInput?.prompt).toContain('Planner Workflow Node Prompt');
    expect(callInput?.prompt).toContain('Planner contract');
    expect(callInput?.prompt).toContain('Builder Handoff');
    expect(callInput?.prompt).toContain('Acceptance Criteria');
    expect(callInput?.prompt).toContain(
      '不要把“梳理、调研、明确现状、确认哪些节点”',
    );
    expect(callInput?.prompt).toContain('输出 `planning_update` 明确缺口');
    expect(callInput?.prompt).toContain('不要写函数级实现');
    expect(callInput?.prompt).toContain('模块级改动');
    expect(callInput?.prompt).toContain('Mermaid 图表');
  });

  it('当 Agent 返回澄清消息时，期望发布 Planning Update', async () => {
    runnerMock.mockResolvedValueOnce({
      success: true,
      data: {
        run: {
          runId: 'run-1',
          taskId: 'task-1',
          threadId: 'thread-1',
          agentId: 'planner',
          provider: 'codex',
          status: 'succeeded',
          inputArtifactIds: ['art-user'],
          outputArtifactIds: ['art-result'],
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: '2026-01-01T00:00:01.000Z',
        },
        usedResume: false,
        assistantText:
          '{"action":"planning_update","body":"需要确认默认执行仓库。"}',
        structuredOutput: {
          action: 'planning_update',
          body: '需要确认默认执行仓库。',
        },
        outputArtifactIds: ['art-result'],
      },
    });

    const result = await runTaskPlanningAgent({
      taskId: 'task-1',
      cwd: '/tmp/project',
    });

    expect(result.success).toBe(true);
    expect(planningMocks.publishPlanningUpdate).toHaveBeenCalledWith({
      taskId: 'task-1',
      agentId: 'planner',
      body: '需要确认默认执行仓库。',
      kind: 'planner_clarification',
    });
  });

  it('当 Agent 结构化输出包含中文双引号时，期望直接发布计划', async () => {
    runnerMock.mockResolvedValueOnce({
      success: true,
      data: {
        run: {
          runId: 'run-1',
          taskId: 'task-1',
          threadId: 'thread-1',
          agentId: 'planner',
          provider: 'codex',
          status: 'succeeded',
          inputArtifactIds: ['art-user'],
          outputArtifactIds: ['art-result'],
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: '2026-01-01T00:00:01.000Z',
        },
        usedResume: false,
        assistantText:
          '{"action":"plan_revision","body":"按钮文案说的是"删除下方的演示数据"。"}',
        structuredOutput: {
          action: 'plan_revision',
          body: '按钮文案说的是“删除下方的演示数据”。',
        },
        outputArtifactIds: ['art-result'],
      },
    });

    const result = await runTaskPlanningAgent({
      taskId: 'task-1',
      cwd: '/tmp/project',
    });

    expect(result.success).toBe(true);
    expect(planningMocks.publishTaskPlanRevision).toHaveBeenCalledWith({
      taskId: 'task-1',
      agentId: 'planner',
      body: '按钮文案说的是“删除下方的演示数据”。',
      type: undefined,
      metadata: {
        kind: 'planner_contract',
        nodePrompt: {
          name: 'planner',
          version: 'v1',
        },
      },
    });
  });
});
