// biome-ignore-all lint/style/noMagicNumbers: tests assert HTTP status codes directly.
import { beforeEach, expect, it, vi } from 'vitest';
import { handleTaskApiRequest } from './task-api';
import {
  expectScheduledDelivery,
  expectScheduledRunner,
  jsonRequest,
  type PlanningMocks,
  resetPlanningMocks,
  snapshot,
  TEST_PLAN_STATUS,
  TEST_TASK_LIFECYCLE,
  TEST_TASK_STATUS,
  TEST_THREAD_STATUS,
  TEST_WORKFLOW_KIND,
} from './task-api.test-utils';

const planningMocks: PlanningMocks = vi.hoisted(() => ({
  approveTaskImplementationSteps: vi.fn(),
  approveCurrentTaskPlan: vi.fn(),
  cancelTaskAgentRun: vi.fn(),
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
const mockTaskConstants = vi.hoisted(() => ({
  TASK_AGENT_STAGE: {
    PLANNING: 'planning',
    IMPLEMENTATION: 'implementation',
    DELIVERY: 'delivery',
  },
  TASK_EXECUTION_MODE: {
    MANUAL: 'manual',
    AUTONOMOUS: 'autonomous',
  },
  TASK_RUNTIME_EXECUTION_MODE: {
    AUTO: 'auto',
    ASK: 'ask',
    PLAN: 'plan',
    BUILD: 'build',
  },
  TASK_LIFECYCLE: {
    CANCELLED: 'cancelled',
    READY: 'ready',
  },
  TASK_STATUS: {
    IMPLEMENTED: 'implemented',
    PLANNING_APPROVED: 'planning_approved',
  },
  THREAD_STATUS: {
    APPROVED: 'approved',
  },
  WORKFLOW_KIND: {
    IMPLEMENTATION: 'implementation',
    PLANNING: 'planning',
  },
}));

vi.mock('../domain/task-planning', () => ({
  TASK_AGENT_STAGE: mockTaskConstants.TASK_AGENT_STAGE,
  TASK_EXECUTION_MODE: mockTaskConstants.TASK_EXECUTION_MODE,
  TASK_RUNTIME_EXECUTION_MODE: mockTaskConstants.TASK_RUNTIME_EXECUTION_MODE,
  TASK_LIFECYCLE: mockTaskConstants.TASK_LIFECYCLE,
  WORKFLOW_KIND: mockTaskConstants.WORKFLOW_KIND,
  approveTaskImplementationSteps: planningMocks.approveTaskImplementationSteps,
  approveCurrentTaskPlan: planningMocks.approveCurrentTaskPlan,
  cancelTaskAgentRun: planningMocks.cancelTaskAgentRun,
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

beforeEach(() => resetPlanningMocks(planningMocks));

it('当手动重新规划且请求未带 cwd 时，期望复用 Task 保存的 cwd', async () => {
  const scheduled: unknown[] = [];
  planningMocks.readTaskPlanningSnapshot.mockReturnValue({
    success: true,
    data: {
      ...snapshot,
      task: { ...snapshot.task, cwd: '/tmp/kinkeeper' },
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
  expectScheduledRunner(scheduled, '/tmp/kinkeeper', 'manual');
});

it('当旧 Task 未保存 cwd 时，期望手动重新规划复用 Agent Binding cwd', async () => {
  const scheduled: unknown[] = [];
  planningMocks.readTaskAgentBinding.mockReturnValue({
    success: true,
    data: {
      threadId: 'thread-1',
      agentId: 'planner',
      provider: 'codex',
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
  expectScheduledRunner(scheduled, '/tmp/binding-repo', 'manual');
});

it('当 Task 方案已批准时，期望可以调度 implementation', async () => {
  const scheduled: unknown[] = [];
  planningMocks.readTaskPlanningSnapshot.mockReturnValue({
    success: true,
    data: approvedSnapshot(
      '/tmp/project',
      mockTaskConstants.TASK_STATUS.PLANNING_APPROVED,
    ),
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
  expectScheduledRunner(scheduled, '/tmp/project', 'manual');
});

it('当实施步骤已产出但未确认时，期望拒绝直接调度编码', async () => {
  const scheduled: unknown[] = [];
  planningMocks.readTaskPlanningSnapshot.mockReturnValue({
    success: true,
    data: approvedSnapshot(
      '/tmp/project',
      mockTaskConstants.TASK_STATUS.PLANNING_APPROVED,
      {
        withSteps: true,
      },
    ),
  });

  const response = await handleTaskApiRequest(
    jsonRequest('/api/tasks/task-1/implementation', {}),
    new URL('http://localhost/api/tasks/task-1/implementation'),
    {
      defaultCwd: '/tmp/default',
      scheduleImplementation: (input) => scheduled.push(input),
    },
  );
  const payload = (await response.json()) as { error: string };

  expect(response.status).toBe(409);
  expect(payload.error).toBe('实施步骤已产出，需人工确认后才能开始编码');
  expect(scheduled).toEqual([]);
});

it('当实施步骤已产出且请求显式确认时，期望记录确认并调度 implementation', async () => {
  const scheduled: unknown[] = [];
  planningMocks.readTaskPlanningSnapshot.mockReturnValue({
    success: true,
    data: approvedSnapshot(
      '/tmp/project',
      mockTaskConstants.TASK_STATUS.PLANNING_APPROVED,
      {
        withSteps: true,
      },
    ),
  });

  const response = await handleTaskApiRequest(
    jsonRequest('/api/tasks/task-1/implementation', {
      confirmImplementationSteps: true,
    }),
    new URL('http://localhost/api/tasks/task-1/implementation'),
    {
      defaultCwd: '/tmp/default',
      scheduleImplementation: (input) => scheduled.push(input),
    },
  );

  expect(response.status).toBe(202);
  expect(planningMocks.approveTaskImplementationSteps).toHaveBeenCalledWith(
    'task-1',
  );
  expectScheduledRunner(scheduled, '/tmp/project', 'manual');
});

it('当 Task 已实现时，期望可以调度 delivery', async () => {
  const scheduled: unknown[] = [];
  planningMocks.readTaskPlanningSnapshot.mockReturnValue({
    success: true,
    data: approvedSnapshot(
      '/tmp/project',
      mockTaskConstants.TASK_STATUS.IMPLEMENTED,
    ),
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
  expectScheduledDelivery(scheduled, '/tmp/project');
});

function approvedSnapshot(
  cwd: string,
  status: string,
  options: { withSteps?: boolean } = {},
) {
  const artifacts = options.withSteps
    ? [
        {
          artifactId: 'art-steps',
          taskId: 'task-1',
          threadId: 'thread-1',
          type: 'agent_result',
          role: 'agent',
          body: '## 实施步骤',
          metadata: {
            kind: 'implementation_steps',
            planId: 'plan-1',
            planVersion: 1,
          },
          createdAt: '2026-01-01T00:00:02.000Z',
        },
      ]
    : [];
  return {
    ...snapshot,
    task: {
      ...snapshot.task,
      status,
      lifecycle: TEST_TASK_LIFECYCLE.READY,
      currentWorkflowKind:
        status === TEST_TASK_STATUS.IMPLEMENTED
          ? TEST_WORKFLOW_KIND.IMPLEMENTATION
          : TEST_WORKFLOW_KIND.PLANNING,
      cwd,
      repoOwner: 'ranwawa',
      repoName: 'along',
    },
    artifacts,
    thread: {
      ...snapshot.thread,
      status: TEST_PLAN_STATUS.APPROVED,
      currentPlanId: 'plan-1',
      approvedPlanId: 'plan-1',
    },
    currentPlan: {
      planId: 'plan-1',
      taskId: 'task-1',
      threadId: 'thread-1',
      version: 1,
      status: TEST_THREAD_STATUS.APPROVED,
      artifactId: 'art-plan',
      body: '## Plan',
      createdAt: '2026-01-01T00:00:01.000Z',
    },
    plans: [
      {
        planId: 'plan-1',
        taskId: 'task-1',
        threadId: 'thread-1',
        version: 1,
        status: TEST_PLAN_STATUS.APPROVED,
        artifactId: 'art-plan',
        body: '## Plan',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    ],
  };
}
