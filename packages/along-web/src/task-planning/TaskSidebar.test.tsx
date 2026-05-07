import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TaskPlanningSnapshot } from '../types';
import { TaskListPanel } from './TaskSidebar';

function makeTask(
  overrides: Partial<TaskPlanningSnapshot['task']> = {},
): TaskPlanningSnapshot['task'] {
  return {
    taskId: 'task-1',
    title: '优化左侧任务列表展示',
    body: '这段任务正文不应该出现在左侧列表。',
    source: 'test',
    status: 'implementing',
    commitShas: [],
    seq: 12,
    executionMode: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: 'custom-updated-at',
    ...overrides,
  };
}

function makeThread(): TaskPlanningSnapshot['thread'] {
  return {
    threadId: 'thread-1',
    taskId: 'task-1',
    purpose: 'planning',
    status: 'approved',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeSnapshot(
  overrides: Partial<TaskPlanningSnapshot> = {},
): TaskPlanningSnapshot {
  return {
    task: makeTask(),
    thread: makeThread(),
    currentPlan: null,
    openRound: null,
    artifacts: [],
    plans: [],
    agentRuns: [],
    agentProgressEvents: [],
    agentSessionEvents: [],
    agentStages: [
      {
        stage: 'implementation',
        agentId: 'implementer',
        label: '实现',
        status: 'failed',
        latestRun: {
          runId: 'run-1',
          taskId: 'task-1',
          threadId: 'thread-1',
          agentId: 'implementer',
          provider: 'codex',
          status: 'failed',
          inputArtifactIds: [],
          outputArtifactIds: [],
          error: '命令退出码 1',
          startedAt: '2026-01-01T00:01:00.000Z',
          endedAt: '2026-01-01T00:02:00.000Z',
        },
      },
    ],
    flow: {
      currentStageId: 'implementation',
      conclusion: '实现阶段失败。',
      severity: 'blocked',
      stages: [],
      actions: [],
      blockers: [],
      events: [],
    },
    ...overrides,
  };
}

function renderPanel(
  overrides: Partial<Parameters<typeof TaskListPanel>[0]> = {},
): string {
  return renderToStaticMarkup(
    <TaskListPanel
      tasks={[makeSnapshot()]}
      loading={false}
      selectedTaskId={undefined}
      isNewTaskOpen={false}
      onNewTask={() => undefined}
      onSelect={() => undefined}
      {...overrides}
    />,
  );
}

describe('TaskListPanel', () => {
  it('任务项只展示序号、标题和状态', () => {
    const html = renderPanel();

    expect(html).toContain('#12');
    expect(html).toContain('优化左侧任务列表展示');
    expect(html).toContain('实现中');
    expect(html).not.toContain('custom-updated-at');
    expect(html).not.toContain('这段任务正文不应该出现在左侧列表');
    expect(html).not.toContain('命令退出码 1');
    expect(html).not.toContain('实现失败');
  });

  it('序号缺失时不补造占位内容', () => {
    const html = renderPanel({
      tasks: [makeSnapshot({ task: makeTask({ seq: undefined }) })],
    });

    expect(html).toContain('优化左侧任务列表展示');
    expect(html).not.toContain('#');
  });

  it('保留选中态、新任务入口、加载态和空态', () => {
    const selectedHtml = renderPanel({ selectedTaskId: 'task-1' });
    const loadingHtml = renderPanel({ tasks: [], loading: true });
    const emptyHtml = renderPanel({ tasks: [] });

    expect(selectedHtml).toContain('bg-white/10');
    expect(selectedHtml).toContain('新任务');
    expect(loadingHtml).toContain('加载中...');
    expect(emptyHtml).toContain('暂无任务。');
  });
});
