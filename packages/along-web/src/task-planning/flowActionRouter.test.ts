import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type {
  TaskAgentStage,
  TaskFlowAction,
  TaskPlanningSnapshot,
} from '../types';
import type { UseTaskPlanningActionsInput } from './actionTypes';
import { type FlowActionParts, runFlowAction } from './flowActionRouter';

function makeDispatch<T>(): Dispatch<SetStateAction<T>> {
  return vi.fn() as Dispatch<SetStateAction<T>>;
}

function makeAction(): TaskFlowAction {
  return {
    id: 'resume_failed_stage',
    label: '继续执行',
    description: '恢复最近失败阶段并继续执行',
    enabled: true,
    stage: 'implementation',
    variant: 'primary',
  };
}

function makeSnapshot(stage: TaskAgentStage): TaskPlanningSnapshot {
  return {
    task: {
      taskId: 'task-1',
      title: '测试任务',
      body: '测试任务内容',
      source: 'test',
      status: 'planning_approved',
      commitShas: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    thread: {
      threadId: 'thread-1',
      taskId: 'task-1',
      purpose: 'planning',
      status: 'approved',
      approvedPlanId: 'plan-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    currentPlan: null,
    openRound: null,
    artifacts: [],
    plans: [],
    agentRuns: [],
    agentProgressEvents: [],
    agentSessionEvents: [],
    agentStages: [
      {
        stage,
        agentId: stage === 'implementation' ? 'implementer' : stage,
        label: stage,
        status: 'failed',
        latestRun: {
          runId: 'run-1',
          taskId: 'task-1',
          threadId: 'thread-1',
          agentId: stage === 'implementation' ? 'implementer' : stage,
          provider: stage === 'delivery' ? 'system' : 'codex',
          status: 'failed',
          inputArtifactIds: [],
          outputArtifactIds: [],
          error: 'failed',
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: '2026-01-01T00:00:01.000Z',
        },
      },
    ],
    flow: {
      currentStageId: 'implementation',
      conclusion: '失败',
      severity: 'blocked',
      stages: [],
      actions: [],
      blockers: [],
      events: [],
    },
  };
}

function makeInput(
  selected: TaskPlanningSnapshot,
): UseTaskPlanningActionsInput {
  return {
    selected,
    draft: { title: '', body: '', repository: '' },
    messageBody: '',
    busyAction: null,
    repositoriesRefreshing: false,
    canApprove: false,
    canImplement: false,
    canDeliver: false,
    setDraft: makeDispatch(),
    setTasks: makeDispatch(),
    setSelectedTaskId: makeDispatch(),
    setIsNewTaskOpen: makeDispatch(),
    setSelectedSnapshot: makeDispatch(),
    setMessageBody: makeDispatch(),
    setBusyAction: makeDispatch(),
    setRepositoriesRefreshing: makeDispatch(),
    setError: makeDispatch(),
    loadRepositories: vi.fn(),
    loadSelectedTask: vi.fn(),
  };
}

function makeActions() {
  return {
    submitMessageFromFlow: vi.fn(),
    copyManualResumeCommand: vi.fn(),
    completeManualStage: vi.fn(),
    runSimpleAction: vi.fn(),
  } satisfies FlowActionParts;
}

describe('flowActionRouter', () => {
  it.each([
    ['planning', 'planner'],
    ['implementation', 'implementation'],
    ['delivery', 'delivery'],
  ] as const)('当继续执行失败的 %s 阶段时，期望调度对应 API', (stage, path) => {
    const actions = makeActions();

    runFlowAction(makeAction(), makeInput(makeSnapshot(stage)), actions);

    expect(actions.runSimpleAction).toHaveBeenCalledWith(
      `resume-${stage}`,
      path,
      true,
    );
  });

  it('当确认实施步骤时，期望带显式确认参数调度 implementation API', () => {
    const actions = makeActions();
    const action: TaskFlowAction = {
      id: 'confirm_implementation_steps',
      label: '确认步骤并开始实现',
      description: '确认步骤',
      enabled: true,
      stage: 'implementation',
      variant: 'primary',
    };

    runFlowAction(action, makeInput(makeSnapshot('implementation')), actions);

    expect(actions.runSimpleAction).toHaveBeenCalledWith(
      'implementation',
      'implementation',
      false,
      { confirmImplementationSteps: true },
    );
  });
});
