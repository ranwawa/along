import { beforeEach, expect, it, vi } from 'vitest';
import { handleTaskApiRequest, isTaskApiPath } from './task-api';
import {
  expectScheduledRunner,
  jsonRequest,
  type PlanningMocks,
  resetPlanningMocks,
  snapshot,
} from './task-api.test-utils';

const planningMocks: PlanningMocks = vi.hoisted(() => ({
  approveTaskImplementationSteps: vi.fn(),
  approveCurrentTaskPlan: vi.fn(),
  closeTask: vi.fn(),
  completeDeliveredTask: vi.fn(),
  completeTaskAgentStageManually: vi.fn(),
  createPlanningTask: vi.fn(),
  listTaskPlanningSnapshots: vi.fn(),
  readTaskAgentBinding: vi.fn(),
  readTaskPlanningSnapshot: vi.fn(),
  requestTaskPlan: vi.fn(),
  submitTaskMessage: vi.fn(),
}));

const cleanupMocks = vi.hoisted(() => ({
  cleanupIssue: vi.fn(),
}));

vi.mock('../domain/task-planning', () => ({
  TASK_EXECUTION_MODE: {
    MANUAL: 'manual',
    AUTONOMOUS: 'autonomous',
  },
  TASK_AGENT_STAGE: {
    PLANNING: 'planning',
    IMPLEMENTATION: 'implementation',
    DELIVERY: 'delivery',
  },
  TASK_LIFECYCLE: {
    CANCELLED: 'cancelled',
    COMPLETED: 'completed',
    OPEN: 'open',
    READY: 'ready',
  },
  WORKFLOW_KIND: {
    IMPLEMENTATION: 'implementation',
    PLANNING: 'planning',
  },
  approveTaskImplementationSteps: planningMocks.approveTaskImplementationSteps,
  approveCurrentTaskPlan: planningMocks.approveCurrentTaskPlan,
  closeTask: planningMocks.closeTask,
  completeDeliveredTask: planningMocks.completeDeliveredTask,
  completeTaskAgentStageManually: planningMocks.completeTaskAgentStageManually,
  createPlanningTask: planningMocks.createPlanningTask,
  listTaskPlanningSnapshots: planningMocks.listTaskPlanningSnapshots,
  readTaskAgentBinding: planningMocks.readTaskAgentBinding,
  readTaskPlanningSnapshot: planningMocks.readTaskPlanningSnapshot,
  requestTaskPlan: planningMocks.requestTaskPlan,
  submitTaskMessage: planningMocks.submitTaskMessage,
}));

vi.mock('../domain/cleanup-utils', () => ({
  cleanupIssue: cleanupMocks.cleanupIssue,
}));

beforeEach(() => resetPlanningMocks(planningMocks));
beforeEach(() => {
  cleanupMocks.cleanupIssue.mockResolvedValue({
    success: true,
    data: undefined,
  });
});

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

it('当创建 Task 指定全自动模式时，期望 executionMode 传给创建层', async () => {
  const response = await handleTaskApiRequest(
    jsonRequest('/api/tasks', {
      body: '创建全自动 planning task。',
      executionMode: 'autonomous',
    }),
    new URL('http://localhost/api/tasks'),
    {
      defaultCwd: '/tmp/default',
      scheduleTitleSummary: () => {},
    },
  );

  expect(response.status).toBe(201);
  expect(planningMocks.createPlanningTask).toHaveBeenCalledWith(
    expect.objectContaining({
      executionMode: 'autonomous',
    }),
  );
});

it('当 multipart 创建 Task 带图片时，期望附件传给创建层且仍调度 planner', async () => {
  const scheduled: unknown[] = [];
  const form = new FormData();
  form.append('body', '请看截图处理这个问题。');
  form.append('owner', 'ranwawa');
  form.append('repo', 'along');
  form.append(
    'attachments',
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'screen.png', {
      type: 'image/png',
    }),
  );

  const response = await handleTaskApiRequest(
    new Request('http://localhost/api/tasks', {
      method: 'POST',
      body: form,
    }),
    new URL('http://localhost/api/tasks'),
    {
      defaultCwd: '/tmp/default',
      resolveRepoPath: () => '/tmp/along',
      schedulePlanner: (input) => scheduled.push(input),
      scheduleTitleSummary: () => {},
    },
  );

  expect(response.status).toBe(202);
  expect(planningMocks.createPlanningTask).toHaveBeenCalledWith(
    expect.objectContaining({
      body: '请看截图处理这个问题。',
      attachments: [
        expect.objectContaining({
          originalName: 'screen.png',
          mimeType: 'image/png',
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        }),
      ],
    }),
  );
  expectScheduledRunner(scheduled, '/tmp/along', 'task_created');
});

it('当创建 Task 指定非法执行模式时，期望返回 400', async () => {
  const response = await handleTaskApiRequest(
    jsonRequest('/api/tasks', {
      body: '创建非法模式 planning task。',
      executionMode: 'fast',
    }),
    new URL('http://localhost/api/tasks'),
    {
      defaultCwd: '/tmp/default',
      scheduleTitleSummary: () => {},
    },
  );
  const payload = (await response.json()) as { error: string };

  expect(response.status).toBe(400);
  expect(payload.error).toBe('executionMode 必须是 manual 或 autonomous');
  expect(planningMocks.createPlanningTask).not.toHaveBeenCalled();
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

it('当 multipart 追加用户消息带图片时，期望附件传给消息层', async () => {
  const form = new FormData();
  form.append('body', '补一张截图。');
  form.append('autoRun', 'false');
  form.append(
    'attachments',
    new File([new Uint8Array([0xff, 0xd8, 0xff])], 'error.jpg', {
      type: 'image/jpeg',
    }),
  );

  const response = await handleTaskApiRequest(
    new Request('http://localhost/api/tasks/task-1/messages', {
      method: 'POST',
      body: form,
    }),
    new URL('http://localhost/api/tasks/task-1/messages'),
    { defaultCwd: '/tmp/default', schedulePlanner: () => {} },
  );

  expect(response.status).toBe(200);
  expect(planningMocks.submitTaskMessage).toHaveBeenCalledWith({
    taskId: 'task-1',
    body: '补一张截图。',
    attachments: [
      expect.objectContaining({
        originalName: 'error.jpg',
        mimeType: 'image/jpeg',
        bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      }),
    ],
  });
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
  const deliveredSnapshot = {
    ...snapshot,
    task: {
      ...snapshot.task,
      lifecycle: 'open',
      repoOwner: 'ranwawa',
      repoName: 'along',
      cwd: '/repo/along',
      seq: 25,
      worktreePath: '/repo/along/tasks/25/worktree',
      branchName: 'fix/demo-25',
      prUrl: 'https://github.com/ranwawa/along/pull/25',
      prNumber: 25,
    },
  };
  planningMocks.readTaskPlanningSnapshot.mockReturnValueOnce({
    success: true,
    data: deliveredSnapshot,
  });

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
  expect(cleanupMocks.cleanupIssue).toHaveBeenCalledWith(
    '25',
    {
      reason: 'delivery_acceptance',
      worktreePath: '/repo/along/tasks/25/worktree',
      branchName: 'fix/demo-25',
    },
    'ranwawa',
    'along',
    '/repo/along',
  );
  expect(planningMocks.completeDeliveredTask).toHaveBeenCalledWith('task-1');
  expect(cleanupMocks.cleanupIssue.mock.invocationCallOrder[0]).toBeLessThan(
    planningMocks.completeDeliveredTask.mock.invocationCallOrder[0],
  );
});

it('当验收清理失败时，期望不继续完成 Task', async () => {
  cleanupMocks.cleanupIssue.mockResolvedValueOnce({
    success: false,
    error: 'worktree 清理失败',
  });
  planningMocks.readTaskPlanningSnapshot.mockReturnValueOnce({
    success: true,
    data: {
      ...snapshot,
      task: {
        ...snapshot.task,
        repoOwner: 'ranwawa',
        repoName: 'along',
        cwd: '/repo/along',
        seq: 25,
        worktreePath: '/repo/along/tasks/25/worktree',
        branchName: 'fix/demo-25',
        prUrl: 'https://github.com/ranwawa/along/pull/25',
        prNumber: 25,
      },
    },
  });

  const response = await handleTaskApiRequest(
    jsonRequest('/api/tasks/task-1/complete', {}),
    new URL('http://localhost/api/tasks/task-1/complete'),
    { defaultCwd: '/tmp/default' },
  );
  const payload = (await response.json()) as { error: string };

  expect(response.status).toBe(409);
  expect(payload.error).toBe('worktree 清理失败');
  expect(planningMocks.completeDeliveredTask).not.toHaveBeenCalled();
});

it('当关闭 Task 时，期望返回关闭后的 snapshot', async () => {
  const response = await handleTaskApiRequest(
    jsonRequest('/api/tasks/task-1/close', { reason: '不再继续' }),
    new URL('http://localhost/api/tasks/task-1/close'),
    { defaultCwd: '/tmp/default' },
  );
  const payload = (await response.json()) as {
    taskId: string;
    snapshot: typeof snapshot;
  };

  expect(response.status).toBe(200);
  expect(payload.taskId).toBe('task-1');
  expect(planningMocks.closeTask).toHaveBeenCalledWith('task-1', '不再继续');
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
    executionMode: undefined,
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
    executionMode: undefined,
  });
}
