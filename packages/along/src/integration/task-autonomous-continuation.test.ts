import { beforeEach, expect, it, vi } from 'vitest';
import {
  continueAutonomousTaskAfterImplementation,
  continueAutonomousTaskAfterPlanning,
} from './task-autonomous-continuation';

const planningMocks = vi.hoisted(() => ({
  approveTaskImplementationSteps: vi.fn(),
  approveCurrentTaskPlan: vi.fn(),
  readTaskPlanningSnapshot: vi.fn(),
}));
const mockTaskConstants = vi.hoisted(() => ({
  PLAN_STATUS: {
    ACTIVE: 'active',
    APPROVED: 'approved',
  },
  TASK_EXECUTION_MODE: {
    MANUAL: 'manual',
    AUTONOMOUS: 'autonomous',
  },
  TASK_LIFECYCLE: {
    CANCELLED: 'cancelled',
    OPEN: 'open',
    READY: 'ready',
  },
  TASK_STATUS: {
    IMPLEMENTED: 'implemented',
    PLANNING: 'planning',
    PLANNING_APPROVED: 'planning_approved',
  },
  THREAD_PURPOSE: {
    PLANNING: 'planning',
  },
  THREAD_STATUS: {
    APPROVED: 'approved',
    AWAITING_APPROVAL: 'awaiting_approval',
  },
  WORKFLOW_KIND: {
    PLANNING: 'planning',
    IMPLEMENTATION: 'implementation',
  },
}));

vi.mock('../domain/task-planning', () => ({
  PLAN_STATUS: mockTaskConstants.PLAN_STATUS,
  TASK_EXECUTION_MODE: mockTaskConstants.TASK_EXECUTION_MODE,
  TASK_LIFECYCLE: mockTaskConstants.TASK_LIFECYCLE,
  WORKFLOW_KIND: mockTaskConstants.WORKFLOW_KIND,
  approveTaskImplementationSteps: planningMocks.approveTaskImplementationSteps,
  approveCurrentTaskPlan: planningMocks.approveCurrentTaskPlan,
  readTaskPlanningSnapshot: planningMocks.readTaskPlanningSnapshot,
}));

beforeEach(() => {
  vi.clearAllMocks();
  planningMocks.approveCurrentTaskPlan.mockReturnValue({
    success: true,
    data: plan,
  });
  planningMocks.approveTaskImplementationSteps.mockReturnValue({
    success: true,
    data: stepsApproval,
  });
});

it('autonomous planner 产出正式 plan 后自动批准并调度 implementation', () => {
  const scheduled: unknown[] = [];
  planningMocks.readTaskPlanningSnapshot.mockReturnValue({
    success: true,
    data: makeSnapshot(),
  });

  const result = continueAutonomousTaskAfterPlanning({
    taskId: 'task-1',
    cwd: '/tmp/project',
    plannerAction: 'plan_revision',
    scheduleImplementation: (input) => scheduled.push(input),
  });

  expect(result).toEqual({ success: true, data: 'approved_plan' });
  expect(planningMocks.approveCurrentTaskPlan).toHaveBeenCalledWith('task-1');
  expect(scheduled).toEqual([
    { taskId: 'task-1', cwd: '/tmp/project', reason: 'autonomous' },
  ]);
});

it('planner 产出 planning_update 时不自动批准', () => {
  const scheduled: unknown[] = [];

  const result = continueAutonomousTaskAfterPlanning({
    taskId: 'task-1',
    cwd: '/tmp/project',
    plannerAction: 'planning_update',
    scheduleImplementation: (input) => scheduled.push(input),
  });

  expect(result).toEqual({ success: true, data: 'skipped' });
  expect(planningMocks.readTaskPlanningSnapshot).not.toHaveBeenCalled();
  expect(scheduled).toEqual([]);
});

it('存在 openRound 时不自动批准 plan', () => {
  const scheduled: unknown[] = [];
  planningMocks.readTaskPlanningSnapshot.mockReturnValue({
    success: true,
    data: makeSnapshot({ openRound: { roundId: 'round-1' } }),
  });

  const result = continueAutonomousTaskAfterPlanning({
    taskId: 'task-1',
    cwd: '/tmp/project',
    plannerAction: 'plan_revision',
    scheduleImplementation: (input) => scheduled.push(input),
  });

  expect(result).toEqual({ success: true, data: 'skipped' });
  expect(planningMocks.approveCurrentTaskPlan).not.toHaveBeenCalled();
  expect(scheduled).toEqual([]);
});

it('implementation 仅产出步骤时自动确认并二次调度', () => {
  const scheduled: unknown[] = [];
  planningMocks.readTaskPlanningSnapshot.mockReturnValue({
    success: true,
    data: makeSnapshot({
      task: {
        status: mockTaskConstants.TASK_STATUS.PLANNING_APPROVED,
        lifecycle: mockTaskConstants.TASK_LIFECYCLE.READY,
        currentWorkflowKind: mockTaskConstants.WORKFLOW_KIND.PLANNING,
      },
      thread: { approvedPlanId: 'plan-1' },
      currentPlan: { status: mockTaskConstants.PLAN_STATUS.APPROVED },
      plans: [plan],
      artifacts: [steps],
    }),
  });

  const result = continueAutonomousTaskAfterImplementation({
    taskId: 'task-1',
    cwd: '/tmp/project',
    scheduleImplementation: (input) => scheduled.push(input),
  });

  expect(result).toEqual({
    success: true,
    data: 'approved_implementation_steps',
  });
  expect(planningMocks.approveTaskImplementationSteps).toHaveBeenCalledWith(
    'task-1',
  );
  expect(scheduled).toEqual([
    { taskId: 'task-1', cwd: '/tmp/project', reason: 'autonomous' },
  ]);
});

it('implementation 完成且有 commit 后自动调度 delivery', () => {
  const scheduled: unknown[] = [];
  planningMocks.readTaskPlanningSnapshot.mockReturnValue({
    success: true,
    data: makeSnapshot({
      task: {
        status: mockTaskConstants.TASK_STATUS.IMPLEMENTED,
        lifecycle: mockTaskConstants.TASK_LIFECYCLE.READY,
        currentWorkflowKind: mockTaskConstants.WORKFLOW_KIND.IMPLEMENTATION,
        commitShas: ['abc123'],
      },
    }),
  });

  const result = continueAutonomousTaskAfterImplementation({
    taskId: 'task-1',
    cwd: '/tmp/project',
    scheduleDelivery: (input) => scheduled.push(input),
  });

  expect(result).toEqual({ success: true, data: 'scheduled_delivery' });
  expect(scheduled).toEqual([
    { taskId: 'task-1', cwd: '/tmp/project', reason: 'autonomous' },
  ]);
});

it('已有 prUrl 时不重复调度 delivery', () => {
  const scheduled: unknown[] = [];
  planningMocks.readTaskPlanningSnapshot.mockReturnValue({
    success: true,
    data: makeSnapshot({
      task: {
        status: mockTaskConstants.TASK_STATUS.IMPLEMENTED,
        lifecycle: mockTaskConstants.TASK_LIFECYCLE.READY,
        currentWorkflowKind: mockTaskConstants.WORKFLOW_KIND.IMPLEMENTATION,
        commitShas: ['abc123'],
        prUrl: 'https://github.com/ranwawa/along/pull/1',
      },
    }),
  });

  const result = continueAutonomousTaskAfterImplementation({
    taskId: 'task-1',
    cwd: '/tmp/project',
    scheduleDelivery: (input) => scheduled.push(input),
  });

  expect(result).toEqual({ success: true, data: 'skipped' });
  expect(scheduled).toEqual([]);
});

const plan = {
  planId: 'plan-1',
  taskId: 'task-1',
  threadId: 'thread-1',
  version: 1,
  status: mockTaskConstants.PLAN_STATUS.APPROVED,
  artifactId: 'art-plan',
  body: 'Plan',
  createdAt: '2026-01-01T00:00:01.000Z',
};

const steps = {
  artifactId: 'art-steps',
  taskId: 'task-1',
  threadId: 'thread-1',
  type: 'agent_result',
  role: 'agent',
  body: '实施步骤',
  metadata: {
    kind: 'implementation_steps',
    planId: 'plan-1',
  },
  createdAt: '2026-01-01T00:00:02.000Z',
};

const stepsApproval = {
  artifactId: 'art-steps-approval',
  taskId: 'task-1',
  threadId: 'thread-1',
  type: 'approval',
  role: 'user',
  body: 'Approved Implementation Steps for Plan v1',
  metadata: {
    kind: 'implementation_steps_approval',
    planId: 'plan-1',
    stepsArtifactId: 'art-steps',
  },
  createdAt: '2026-01-01T00:00:03.000Z',
};

function makeSnapshot(
  overrides: {
    task?: Record<string, unknown>;
    thread?: Record<string, unknown>;
    currentPlan?: Record<string, unknown> | null;
    openRound?: Record<string, unknown> | null;
    plans?: unknown[];
    artifacts?: unknown[];
  } = {},
) {
  return {
    task: {
      taskId: 'task-1',
      title: 'Task',
      body: 'Body',
      source: 'web',
      status: mockTaskConstants.TASK_STATUS.PLANNING,
      lifecycle: mockTaskConstants.TASK_LIFECYCLE.OPEN,
      currentWorkflowKind: mockTaskConstants.WORKFLOW_KIND.PLANNING,
      activeThreadId: 'thread-1',
      commitShas: [],
      executionMode: mockTaskConstants.TASK_EXECUTION_MODE.AUTONOMOUS,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides.task,
    },
    thread: {
      threadId: 'thread-1',
      taskId: 'task-1',
      purpose: mockTaskConstants.THREAD_PURPOSE.PLANNING,
      status: mockTaskConstants.THREAD_STATUS.AWAITING_APPROVAL,
      currentPlanId: 'plan-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides.thread,
    },
    currentPlan:
      overrides.currentPlan === null
        ? null
        : {
            ...plan,
            status: mockTaskConstants.PLAN_STATUS.ACTIVE,
            ...overrides.currentPlan,
          },
    openRound: overrides.openRound ?? null,
    artifacts: overrides.artifacts || [],
    plans: overrides.plans || [
      { ...plan, status: mockTaskConstants.PLAN_STATUS.ACTIVE },
    ],
    agentRuns: [],
    agentProgressEvents: [],
    agentSessionEvents: [],
    agentStages: [],
    flow: {
      currentStageId: 'plan_confirmation',
      conclusion: '',
      severity: 'normal',
      stages: [],
      actions: [],
      blockers: [],
      events: [],
    },
  };
}
