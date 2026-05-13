// biome-ignore-all lint/style/noMagicNumbers: tests use task seq values directly for readability.
import { describe, expect, it } from 'vitest';
import type { TaskPlanningSnapshot, TaskStatus } from '../types';
import { mergeSnapshotIntoList, sortTaskSnapshotsBySeqDesc } from './api';

function makeSnapshot(
  taskId: string,
  seq: number | undefined,
  overrides: Partial<TaskPlanningSnapshot['task']> = {},
): TaskPlanningSnapshot {
  return {
    task: {
      taskId,
      title: taskId,
      body: '',
      source: 'test',
      status: 'planning',
      commitShas: [],
      seq,
      executionMode: 'manual',
      workspaceMode: 'worktree',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
    thread: {
      threadId: `${taskId}-thread`,
      taskId,
      purpose: 'planning',
      status: 'drafting',
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
    agentStages: [],
    flow: {
      currentStageId: 'requirements',
      conclusion: '',
      severity: 'normal',
      stages: [],
      actions: [],
      blockers: [],
      events: [],
    },
  };
}

function taskIds(snapshots: TaskPlanningSnapshot[]): string[] {
  return snapshots.map((snapshot) => snapshot.task.taskId);
}

describe('sortTaskSnapshotsBySeqDesc', () => {
  it('按任务序号降序排列', () => {
    const snapshots = [
      makeSnapshot('task-2', 2),
      makeSnapshot('task-9', 9),
      makeSnapshot('task-5', 5),
    ];

    expect(taskIds(sortTaskSnapshotsBySeqDesc(snapshots))).toEqual([
      'task-9',
      'task-5',
      'task-2',
    ]);
  });

  it('状态和更新时间变化不影响序号排序', () => {
    const snapshots = [
      makeSnapshot('completed-newer-update', 3, {
        status: 'completed' satisfies TaskStatus,
        updatedAt: '2026-01-03T00:00:00.000Z',
      }),
      makeSnapshot('planning-older-update', 8, {
        status: 'planning' satisfies TaskStatus,
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      makeSnapshot('implementing-middle-update', 5, {
        status: 'implementing' satisfies TaskStatus,
        updatedAt: '2026-01-02T00:00:00.000Z',
      }),
    ];

    expect(taskIds(sortTaskSnapshotsBySeqDesc(snapshots))).toEqual([
      'planning-older-update',
      'implementing-middle-update',
      'completed-newer-update',
    ]);
  });

  it('缺失或不可解析序号排在底部并保持兜底顺序', () => {
    const snapshots = [
      makeSnapshot('missing-seq', undefined),
      makeSnapshot('valid-seq', 4),
      makeSnapshot('nan-seq', Number.NaN),
      makeSnapshot('same-seq-first', 2),
      makeSnapshot('same-seq-second', 2),
    ];

    expect(taskIds(sortTaskSnapshotsBySeqDesc(snapshots))).toEqual([
      'valid-seq',
      'same-seq-first',
      'same-seq-second',
      'missing-seq',
      'nan-seq',
    ]);
  });

  it('支持空列表和单任务列表', () => {
    const snapshot = makeSnapshot('task-1', 1);

    expect(sortTaskSnapshotsBySeqDesc([])).toEqual([]);
    expect(sortTaskSnapshotsBySeqDesc([snapshot])).toEqual([snapshot]);
  });
});

describe('mergeSnapshotIntoList', () => {
  it('刷新同一批任务状态后保持按序号降序的相对顺序', () => {
    const previous = [
      makeSnapshot('task-9', 9, { status: 'planning' }),
      makeSnapshot('task-5', 5, { status: 'implementing' }),
      makeSnapshot('task-2', 2, { status: 'completed' }),
    ];

    const next = mergeSnapshotIntoList(
      previous,
      makeSnapshot('task-5', 5, {
        status: 'completed',
        updatedAt: '2026-01-05T00:00:00.000Z',
      }),
    );

    expect(taskIds(next)).toEqual(['task-9', 'task-5', 'task-2']);
  });
});
