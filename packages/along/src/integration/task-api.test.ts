import { beforeEach, expect, it, vi } from 'vitest';
import { handleTaskApiRequest, isTaskApiPath } from './task-api';
import {
  expectScheduledRunner,
  jsonRequest,
  type PlanningMocks,
  resetPlanningMocks,
  type snapshot,
} from './task-api.test-utils';

const planningMocks: PlanningMocks = vi.hoisted(() => ({
  approveCurrentTaskPlan: vi.fn(),
  completeDeliveredTask: vi.fn(),
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
  completeDeliveredTask: planningMocks.completeDeliveredTask,
  completeTaskAgentStageManually: planningMocks.completeTaskAgentStageManually,
  createPlanningTask: planningMocks.createPlanningTask,
  listTaskPlanningSnapshots: planningMocks.listTaskPlanningSnapshots,
  readTaskAgentBinding: planningMocks.readTaskAgentBinding,
  readTaskPlanningSnapshot: planningMocks.readTaskPlanningSnapshot,
  submitTaskMessage: planningMocks.submitTaskMessage,
}));

beforeEach(() => resetPlanningMocks(planningMocks));

it('当路径属于 Task API 时，期望能识别', () => {
  expect(isTaskApiPath('/api/tasks')).toBe(true);
  expect(isTaskApiPath('/api/tasks/task-1/messages')).toBe(true);
  expect(isTaskApiPath('/api/sessions')).toBe(false);
});

it('当读取 Task 列表带仓库参数时，期望按仓库传给查询层', async () => {
  const url = 'http://localhost/api/tasks?limit=20&owner=ranwawa&repo=along';
  const response = await handleTaskApiRequest(new Request(url), new URL(url), {
    defaultCwd: '/tmp/default',
  });

  expect(response.status).toBe(200);
  expect(planningMocks.listTaskPlanningSnapshots).toHaveBeenCalledWith(20, {
    repoOwner: 'ranwawa',
    repoName: 'along',
  });
});

it('当创建 Task 时，期望返回 202 并调度 planner', async () => {
  const scheduled: unknown[] = [];
  const titleSummaries: unknown[] = [];
  const response = await handleTaskApiRequest(
    jsonRequest('/api/tasks', {
      title: '前端传来的标题应被忽略',
      body: '通过 Web API 创建 planning task。',
      owner: 'ranwawa',
      repo: 'along',
    }),
    new URL('http://localhost/api/tasks'),
    {
      defaultCwd: '/tmp/default',
      resolveRepoPath: () => '/tmp/along',
      schedulePlanner: (input) => scheduled.push(input),
      scheduleTitleSummary: (input) => titleSummaries.push(input),
    },
  );

  await expectCreatedTask(response, true);
  expectCreatedTaskFields('/tmp/along');
  expectScheduledRunner(scheduled, '/tmp/along', 'task_created');
  expect(titleSummaries).toEqual([
    {
      taskId: 'task-1',
      body: '通过 Web API 创建 planning task。',
    },
  ]);
});

it('当创建 Task 未带 owner/repo 时，期望从默认 cwd 反查仓库并落库', async () => {
  const scheduled: unknown[] = [];
  const response = await handleTaskApiRequest(
    jsonRequest('/api/tasks', { body: '通过默认仓库创建 planning task。' }),
    new URL('http://localhost/api/tasks'),
    {
      defaultCwd: '/tmp/along/packages/along',
      resolveRepositoryForPath: expectDefaultRepositoryLookup,
      schedulePlanner: (input) => scheduled.push(input),
      scheduleTitleSummary: () => {},
    },
  );

  expect(response.status).toBe(202);
  expectDefaultCreatedTaskFields();
  expectScheduledRunner(scheduled, '/tmp/along/packages/along', 'task_created');
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
  expectScheduledRunner(scheduled, '/tmp/project', 'user_message');
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

it('当验收已交付 Task 时，期望返回完成后的 snapshot', async () => {
  const response = await handleTaskApiRequest(
    jsonRequest('/api/tasks/task-1/complete', {}),
    new URL('http://localhost/api/tasks/task-1/complete'),
    { defaultCwd: '/tmp/default' },
  );
  const payload = (await response.json()) as {
    taskId: string;
    snapshot: typeof snapshot;
  };

  expect(response.status).toBe(200);
  expect(payload.taskId).toBe('task-1');
  expect(planningMocks.completeDeliveredTask).toHaveBeenCalledWith('task-1');
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

async function expectCreatedTask(response: Response, scheduled: boolean) {
  const payload = (await response.json()) as {
    taskId: string;
    scheduled: boolean;
  };
  expect(response.status).toBe(scheduled ? 202 : 201);
  expect(payload.taskId).toBe('task-1');
  expect(payload.scheduled).toBe(scheduled);
}

function expectCreatedTaskFields(cwd: string) {
  expect(planningMocks.createPlanningTask).toHaveBeenCalledWith({
    title: '通过 Web API 创建 p',
    body: '通过 Web API 创建 planning task。',
    source: 'web',
    repoOwner: 'ranwawa',
    repoName: 'along',
    cwd,
  });
}

function expectDefaultRepositoryLookup(cwd: string) {
  expect(cwd).toBe('/tmp/along/packages/along');
  return { repoOwner: 'ranwawa', repoName: 'along' };
}

function expectDefaultCreatedTaskFields() {
  expect(planningMocks.createPlanningTask).toHaveBeenCalledWith({
    title: '通过默认仓库创建 planni',
    body: '通过默认仓库创建 planning task。',
    source: 'web',
    repoOwner: 'ranwawa',
    repoName: 'along',
    cwd: '/tmp/along/packages/along',
  });
}
