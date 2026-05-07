import { expect, vi } from 'vitest';

type PlanningMock = ReturnType<typeof vi.fn>;

export type PlanningMocks = {
  approveTaskImplementationSteps: PlanningMock;
  approveCurrentTaskPlan: PlanningMock;
  closeTask: PlanningMock;
  completeDeliveredTask: PlanningMock;
  completeTaskAgentStageManually: PlanningMock;
  createPlanningTask: PlanningMock;
  listTaskPlanningSnapshots: PlanningMock;
  readTaskAgentBinding: PlanningMock;
  readTaskPlanningSnapshot: PlanningMock;
  requestTaskPlan: PlanningMock;
  submitTaskMessage: PlanningMock;
};

export const snapshot = {
  task: {
    taskId: 'task-1',
    title: '实现 Task API',
    body: '通过 Web API 创建 planning task。',
    source: 'web',
    status: 'planning',
    activeThreadId: 'thread-1',
    commitShas: [],
    executionMode: 'manual',
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

export function resetPlanningMocks(planningMocks: PlanningMocks) {
  vi.clearAllMocks();
  mockTaskReads(planningMocks);
  mockTaskMessage(planningMocks);
  mockPlanApproval(planningMocks);
  mockTaskClose(planningMocks);
  mockImplementationStepsApproval(planningMocks);
  mockManualComplete(planningMocks);
  mockDeliveredComplete(planningMocks);
}

function mockImplementationStepsApproval(planningMocks: PlanningMocks) {
  planningMocks.approveTaskImplementationSteps.mockReturnValue({
    success: true,
    data: {
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
      createdAt: '2026-01-01T00:00:02.000Z',
    },
  });
}

function mockTaskReads(planningMocks: PlanningMocks) {
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
  planningMocks.requestTaskPlan.mockReturnValue({
    success: true,
    data: undefined,
  });
}

function mockTaskMessage(planningMocks: PlanningMocks) {
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
}

function mockPlanApproval(planningMocks: PlanningMocks) {
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
}

function mockTaskClose(planningMocks: PlanningMocks) {
  planningMocks.closeTask.mockReturnValue({
    success: true,
    data: {
      ...snapshot,
      task: { ...snapshot.task, status: 'closed' },
    },
  });
}

function mockManualComplete(planningMocks: PlanningMocks) {
  planningMocks.completeTaskAgentStageManually.mockReturnValue({
    success: true,
    data: {
      ...snapshot,
      task: { ...snapshot.task, status: 'implemented' },
    },
  });
}

function mockDeliveredComplete(planningMocks: PlanningMocks) {
  planningMocks.completeDeliveredTask.mockReturnValue({
    success: true,
    data: {
      ...snapshot,
      task: { ...snapshot.task, status: 'completed' },
    },
  });
}

export function jsonRequest(
  pathname: string,
  body: Record<string, unknown>,
): Request {
  return new Request(`http://localhost${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function expectScheduledRunner(
  scheduled: unknown[],
  cwd: string,
  reason: 'task_created' | 'user_message' | 'manual' | 'autonomous',
) {
  expect(scheduled).toEqual([
    {
      taskId: 'task-1',
      cwd,
      reason,
      agentId: undefined,
      editor: undefined,
      model: undefined,
      personalityVersion: undefined,
    },
  ]);
}

export function expectScheduledDelivery(scheduled: unknown[], cwd: string) {
  expect(scheduled).toEqual([{ taskId: 'task-1', cwd, reason: 'manual' }]);
}
