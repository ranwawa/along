import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TaskPlanningSnapshot } from '../types';
import type { RepositoryOption } from './api';
import {
  TASK_LEGACY_STATUS_COLORS,
  TASK_STATUS_COLOR_STYLES,
} from './statusStyles';
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

const repositories: RepositoryOption[] = [
  {
    fullName: 'ranwawa/along',
    owner: 'ranwawa',
    repo: 'along',
    path: '/workspace/along',
    isDefault: true,
  },
];

function renderPanel(
  overrides: Partial<Parameters<typeof TaskListPanel>[0]> = {},
): string {
  return renderToStaticMarkup(
    <TaskListPanel
      draft={{
        repository: 'ranwawa/along',
        title: '',
        body: '',
        attachments: [],
        executionMode: 'manual',
        runtimeExecutionMode: 'auto',
      }}
      repositories={repositories}
      error={null}
      tasks={[makeSnapshot()]}
      loading={false}
      selectedTaskId={undefined}
      isNewTaskOpen={false}
      onDraftChange={() => undefined}
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
    expect(html).toContain('aria-label="实现中"');
    expect(html).toContain('title="实现中"');
    expect(html).not.toContain('>实现中<');
    expect(html).not.toContain('custom-updated-at');
    expect(html).not.toContain('这段任务正文不应该出现在左侧列表');
    expect(html).not.toContain('命令退出码 1');
    expect(html).not.toContain('实现失败');
  });

  it('已关闭任务显示独立状态', () => {
    const html = renderPanel({
      tasks: [makeSnapshot({ task: makeTask({ status: 'closed' }) })],
    });

    expect(html).toContain('aria-label="已关闭"');
    expect(html).not.toContain('>已关闭<');
    expect(html).toContain(
      TASK_STATUS_COLOR_STYLES[TASK_LEGACY_STATUS_COLORS.closed].dotClass,
    );
  });

  it('优先使用 display 状态文案和颜色点', () => {
    const html = renderPanel({
      tasks: [
        makeSnapshot({
          display: {
            state: 'waiting_user',
            label: '待用户补充',
          },
        }),
      ],
    });

    expect(html).toContain('aria-label="待用户补充"');
    expect(html).toContain('title="待用户补充"');
    expect(html).not.toContain('>待用户补充<');
    expect(html).toContain(TASK_STATUS_COLOR_STYLES.amber.dotClass);
  });

  it('agentStages 存在运行阶段时显示运行动画', () => {
    const html = renderPanel({
      tasks: [
        makeSnapshot({
          agentStages: [
            {
              stage: 'implementation',
              agentId: 'implementer',
              label: '实现',
              status: 'running',
            },
          ],
        }),
      ],
    });

    expect(html).toContain('after:animate-ping');
    expect(html).toContain('motion-reduce:after:animate-none');
  });

  it('agentStages 非运行阶段时不显示运行动画', () => {
    const html = renderPanel();

    expect(html).not.toContain('after:animate-ping');
  });

  it('序号缺失时不补造占位内容', () => {
    const html = renderPanel({
      tasks: [makeSnapshot({ task: makeTask({ seq: undefined }) })],
    });

    expect(html).toContain('优化左侧任务列表展示');
    expect(html).not.toContain('#');
  });

  it('按照传入的任务顺序渲染列表，最新序号显示在最上方', () => {
    const html = renderPanel({
      tasks: [
        makeSnapshot({
          task: makeTask({
            taskId: 'task-20',
            title: '最新任务',
            seq: 20,
          }),
        }),
        makeSnapshot({
          task: makeTask({
            taskId: 'task-8',
            title: '较早任务',
            seq: 8,
          }),
        }),
      ],
    });

    expect(html.indexOf('#20')).toBeLessThan(html.indexOf('#8'));
    expect(html.indexOf('最新任务')).toBeLessThan(html.indexOf('较早任务'));
  });

  it('保留选中态、新任务入口、加载态和空态', () => {
    const selectedHtml = renderPanel({ selectedTaskId: 'task-1' });
    const loadingHtml = renderPanel({ tasks: [], loading: true });
    const emptyHtml = renderPanel({ tasks: [] });

    expect(selectedHtml).toContain('bg-white/10');
    expect(selectedHtml).toContain('aria-label="新任务"');
    expect(selectedHtml).toContain('新任务');
    expect(selectedHtml).toContain('>+</button>');
    expect(selectedHtml).not.toContain('>任务列表<');
    expect(selectedHtml).not.toContain('>1</span>');
    expect(loadingHtml).toContain('加载中...');
    expect(emptyHtml).toContain('暂无任务。');
  });

  it('在列表头部展示仓库下拉和新任务提示，不展示刷新入口和仓库路径', () => {
    const html = renderPanel();

    expect(html).toContain('aria-label="仓库"');
    expect(html).toContain('ranwawa/along');
    expect(html).not.toContain('/workspace/along');
    expect(html).not.toContain('刷新');
    expect(html).toContain('aria-label="新任务"');
    expect(html).toContain('role="tooltip"');
    expect(html).not.toContain('主入口');
    expect(html).not.toContain('title="/workspace/along"');
    expect(html).not.toContain('title="新任务"');
  });
});
