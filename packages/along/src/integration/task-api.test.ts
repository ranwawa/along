import { beforeEach, describe, expect, it, vi } from 'vitest';

const planningMocks = vi.hoisted(() => ({
  approveCurrentTaskPlan: vi.fn(),
  completeTaskAgentStageManually: vi.fn(),
  createPlanningTask: vi.fn(),
  listTaskPlanningSnapshots: vi.fn(),
  readTaskAgentBinding: vi.fn(),
  readTaskPlanningSnapshot: vi.fn(),
  submitTaskMessage: vi.fn(),
}));

vi.mock('../domain/task-planning', () => ({
  TASK_AGENT_STAGE: {
    PLANNING: 'planning',
    IMPLEMENTATION: 'implementation',
    DELIVERY: 'delivery',
  },
  approveCurrentTaskPlan: planningMocks.approveCurrentTaskPlan,
  completeTaskAgentStageManually: planningMocks.completeTaskAgentStageManually,
  createPlanningTask: planningMocks.createPlanningTask,
  listTaskPlanningSnapshots: planningMocks.listTaskPlanningSnapshots,
  readTaskAgentBinding: planningMocks.readTaskAgentBinding,
  readTaskPlanningSnapshot: planningMocks.readTaskPlanningSnapshot,
  submitTaskMessage: planningMocks.submitTaskMessage,
}));

import { handleTaskApiRequest, isTaskApiPath } from './task-api';

const snapshot = {
  task: {
    taskId: 'task-1',
    title: '实现 Task API',
    body: '通过 Web API 创建 planning task。',
    source: 'web',
    status: 'planning',
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
  artifacts: [],
  plans: [],
};

function jsonRequest(pathname: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('task-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    planningMocks.createPlanningTask.mockReturnValue({
      success: true,
      data: snapshot,
    });
    planningMocks.listTaskPlanningSnapshots.mockReturnValue({
      success: true,
      data: [snapshot],
    });
    planningMocks.readTaskPlanningSnapshot.mockReturnValue({
      success: true,
      data: snapshot,
    });
    planningMocks.readTaskAgentBinding.mockReturnValue({
      success: true,
      data: null,
    });
    planningMocks.submitTaskMessage.mockReturnValue({
      success: true,
      data: {
        artifact: {
          artifactId: 'art-user',
          taskId: 'task-1',
          threadId: 'thread-1',
          type: 'user_message',
          role: 'user',
          body: '继续讨论',
          metadata: {},
          createdAt: '2026-01-01T00:00:01.000Z',
        },
        round: null,
      },
    });
    planningMocks.approveCurrentTaskPlan.mockReturnValue({
      success: true,
      data: {
        planId: 'plan-1',
        taskId: 'task-1',
        threadId: 'thread-1',
        version: 1,
        status: 'approved',
        artifactId: 'art-plan',
        body: '## Plan',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    });
    planningMocks.completeTaskAgentStageManually.mockReturnValue({
      success: true,
      data: {
        ...snapshot,
        task: {
          ...snapshot.task,
          status: 'implemented',
        },
      },
    });
  });

  it('当路径属于 Task API 时，期望能识别', () => {
    expect(isTaskApiPath('/api/tasks')).toBe(true);
    expect(isTaskApiPath('/api/tasks/task-1/messages')).toBe(true);
    expect(isTaskApiPath('/api/sessions')).toBe(false);
  });

  it('当创建 Task 时，期望返回 202 并调度 planner', async () => {
    const scheduled: unknown[] = [];
    const response = await handleTaskApiRequest(
      jsonRequest('/api/tasks', {
        body: '通过 Web API 创建 planning task。',
        owner: 'ranwawa',
        repo: 'along',
      }),
      new URL('http://localhost/api/tasks'),
      {
        defaultCwd: '/tmp/default',
        resolveRepoPath: () => '/tmp/along',
        schedulePlanner: (input) => scheduled.push(input),
      },
    );
    const payload = (await response.json()) as {
      taskId: string;
      scheduled: boolean;
    };

    expect(response.status).toBe(202);
    expect(payload.taskId).toBe('task-1');
    expect(payload.scheduled).toBe(true);
    expect(planningMocks.createPlanningTask).toHaveBeenCalledWith({
      title: '通过 Web API 创建 planning task。',
      body: '通过 Web API 创建 planning task。',
      source: 'web',
      repoOwner: 'ranwawa',
      repoName: 'along',
      cwd: '/tmp/along',
    });
    expect(scheduled).toEqual([
      {
        taskId: 'task-1',
        cwd: '/tmp/along',
        reason: 'task_created',
        agentId: undefined,
        editor: undefined,
        model: undefined,
        personalityVersion: undefined,
      },
    ]);
  });

  it('当追加用户消息时，期望记录消息并调度同一个 Task planner', async () => {
    const scheduled: unknown[] = [];
    const response = await handleTaskApiRequest(
      jsonRequest('/api/tasks/task-1/messages', {
        body: '继续讨论这个方案。',
        cwd: '/tmp/project',
      }),
      new URL('http://localhost/api/tasks/task-1/messages'),
      {
        defaultCwd: '/tmp/default',
        schedulePlanner: (input) => scheduled.push(input),
      },
    );

    expect(response.status).toBe(202);
    expect(planningMocks.submitTaskMessage).toHaveBeenCalledWith({
      taskId: 'task-1',
      body: '继续讨论这个方案。',
    });
    expect(scheduled).toEqual([
      {
        taskId: 'task-1',
        cwd: '/tmp/project',
        reason: 'user_message',
        agentId: undefined,
        editor: undefined,
        model: undefined,
        personalityVersion: undefined,
      },
    ]);
  });

  it('当手动重新规划且请求未带 cwd 时，期望复用 Task 保存的 cwd', async () => {
    const scheduled: unknown[] = [];
    planningMocks.readTaskPlanningSnapshot.mockReturnValue({
      success: true,
      data: {
        ...snapshot,
        task: {
          ...snapshot.task,
          cwd: '/tmp/kinkeeper',
          repoOwner: 'ranwawa',
          repoName: 'kinkeeper',
        },
      },
    });

    const response = await handleTaskApiRequest(
      jsonRequest('/api/tasks/task-1/planner', {}),
      new URL('http://localhost/api/tasks/task-1/planner'),
      {
        defaultCwd: '/tmp/default',
        schedulePlanner: (input) => scheduled.push(input),
      },
    );

    expect(response.status).toBe(202);
    expect(scheduled).toEqual([
      {
        taskId: 'task-1',
        cwd: '/tmp/kinkeeper',
        reason: 'manual',
        agentId: undefined,
        editor: undefined,
        model: undefined,
        personalityVersion: undefined,
      },
    ]);
  });

  it('当旧 Task 未保存 cwd 时，期望手动重新规划复用 Agent Binding cwd', async () => {
    const scheduled: unknown[] = [];
    planningMocks.readTaskAgentBinding.mockReturnValue({
      success: true,
      data: {
        threadId: 'thread-1',
        agentId: 'planner',
        provider: 'claude',
        cwd: '/tmp/binding-repo',
        updatedAt: '2026-01-01T00:00:01.000Z',
      },
    });

    const response = await handleTaskApiRequest(
      jsonRequest('/api/tasks/task-1/planner', {}),
      new URL('http://localhost/api/tasks/task-1/planner'),
      {
        defaultCwd: '/tmp/default',
        schedulePlanner: (input) => scheduled.push(input),
      },
    );

    expect(response.status).toBe(202);
    expect(scheduled).toEqual([
      {
        taskId: 'task-1',
        cwd: '/tmp/binding-repo',
        reason: 'manual',
        agentId: undefined,
        editor: undefined,
        model: undefined,
        personalityVersion: undefined,
      },
    ]);
  });

  it('当 Task 方案已批准时，期望可以调度 implementation', async () => {
    const scheduled: unknown[] = [];
    planningMocks.readTaskPlanningSnapshot.mockReturnValue({
      success: true,
      data: {
        ...snapshot,
        task: {
          ...snapshot.task,
          status: 'planning_approved',
          cwd: '/tmp/project',
        },
        thread: {
          ...snapshot.thread,
          status: 'approved',
          approvedPlanId: 'plan-1',
        },
      },
    });

    const response = await handleTaskApiRequest(
      jsonRequest('/api/tasks/task-1/implementation', {}),
      new URL('http://localhost/api/tasks/task-1/implementation'),
      {
        defaultCwd: '/tmp/default',
        scheduleImplementation: (input) => scheduled.push(input),
      },
    );

    expect(response.status).toBe(202);
    expect(scheduled).toEqual([
      {
        taskId: 'task-1',
        cwd: '/tmp/project',
        reason: 'manual',
        agentId: undefined,
        editor: undefined,
        model: undefined,
        personalityVersion: undefined,
      },
    ]);
  });

  it('当 Task 已实现时，期望可以调度 delivery', async () => {
    const scheduled: unknown[] = [];
    planningMocks.readTaskPlanningSnapshot.mockReturnValue({
      success: true,
      data: {
        ...snapshot,
        task: {
          ...snapshot.task,
          status: 'implemented',
          cwd: '/tmp/project',
          repoOwner: 'ranwawa',
          repoName: 'along',
        },
        thread: {
          ...snapshot.thread,
          status: 'approved',
          approvedPlanId: 'plan-1',
        },
      },
    });

    const response = await handleTaskApiRequest(
      jsonRequest('/api/tasks/task-1/delivery', {}),
      new URL('http://localhost/api/tasks/task-1/delivery'),
      {
        defaultCwd: '/tmp/default',
        scheduleDelivery: (input) => scheduled.push(input),
      },
    );

    expect(response.status).toBe(202);
    expect(scheduled).toEqual([
      {
        taskId: 'task-1',
        cwd: '/tmp/project',
        reason: 'manual',
      },
    ]);
  });

  it('当批准 Task Plan 时，期望不再调度 planner', async () => {
    const scheduled: unknown[] = [];
    const response = await handleTaskApiRequest(
      jsonRequest('/api/tasks/task-1/approve', {}),
      new URL('http://localhost/api/tasks/task-1/approve'),
      {
        defaultCwd: '/tmp/default',
        schedulePlanner: (input) => scheduled.push(input),
      },
    );

    expect(response.status).toBe(200);
    expect(planningMocks.approveCurrentTaskPlan).toHaveBeenCalledWith('task-1');
    expect(scheduled).toEqual([]);
  });

  it('当人工标记实现阶段已处理时，期望返回更新后的 snapshot', async () => {
    const response = await handleTaskApiRequest(
      jsonRequest('/api/tasks/task-1/manual-complete', {
        stage: 'implementation',
        message: '已在 editor 中完成验证。',
      }),
      new URL('http://localhost/api/tasks/task-1/manual-complete'),
      { defaultCwd: '/tmp/default' },
    );
    const payload = (await response.json()) as {
      taskId: string;
      snapshot: typeof snapshot;
    };

    expect(response.status).toBe(200);
    expect(payload.taskId).toBe('task-1');
    expect(planningMocks.completeTaskAgentStageManually).toHaveBeenCalledWith({
      taskId: 'task-1',
      stage: 'implementation',
      message: '已在 editor 中完成验证。',
      prUrl: undefined,
      prNumber: undefined,
    });
  });

  it('当读取不存在的 Task 时，期望返回 404', async () => {
    planningMocks.readTaskPlanningSnapshot.mockReturnValueOnce({
      success: true,
      data: null,
    });

    const response = await handleTaskApiRequest(
      new Request('http://localhost/api/tasks/missing'),
      new URL('http://localhost/api/tasks/missing'),
      { defaultCwd: '/tmp/default' },
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Task 不存在: missing');
  });
});
