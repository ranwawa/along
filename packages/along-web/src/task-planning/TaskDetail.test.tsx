import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { clampSheetWidth } from '../components/ui/sheet';
import type { TaskArtifactRecord, TaskPlanningSnapshot } from '../types';
import type { DraftTaskInput } from './api';
import { TaskDetail } from './TaskDetail';
import { TaskDetailDialog } from './TaskDetailPanels';

const draft: DraftTaskInput = {
  repository: 'ranwawa/along',
  title: '',
  body: '',
  attachments: [],
  executionMode: 'manual',
  runtimeExecutionMode: 'auto',
  workspaceMode: 'worktree',
};

function makeTask(): TaskPlanningSnapshot['task'] {
  return {
    taskId: 'task-1',
    title: '调整任务详情面板',
    body: '把辅助信息放到弹框里。',
    source: 'test',
    status: 'implementing',
    currentWorkflowKind: 'implementation',
    commitShas: [],
    executionMode: 'manual',
    workspaceMode: 'worktree',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:05:00.000Z',
  };
}

function makeThread(): TaskPlanningSnapshot['thread'] {
  return {
    threadId: 'thread-1',
    taskId: 'task-1',
    purpose: 'implementation',
    status: 'implementing',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:05:00.000Z',
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
    agentProgressEvents: [
      {
        progressId: 'progress-1',
        runId: 'run-1',
        taskId: 'task-1',
        threadId: 'thread-1',
        agentId: 'implementer',
        runtimeId: 'codex',
        phase: 'tool',
        summary: '正在执行命令。',
        detail: '运行前端测试。',
        createdAt: '2026-01-01T00:04:00.000Z',
      },
    ],
    agentSessionEvents: [
      {
        eventId: 'session-1',
        runId: 'run-1',
        taskId: 'task-1',
        threadId: 'thread-1',
        agentId: 'implementer',
        runtimeId: 'codex',
        source: 'agent',
        kind: 'output',
        content: '正在输出日志。',
        metadata: {},
        createdAt: '2026-01-01T00:04:30.000Z',
      },
    ],
    agentStages: [],
    flow: {
      currentStageId: 'implementation',
      conclusion: '实现阶段正在执行。',
      severity: 'normal',
      blockers: [],
      stages: [],
      actions: [],
      events: [
        {
          eventId: 'flow-event-1',
          type: 'agent_run_started',
          stage: 'implementation',
          title: '进入实现阶段',
          summary: 'Builder 开始实施。',
          occurredAt: '2026-01-01T00:03:00.000Z',
        },
      ],
    },
    ...overrides,
  };
}

function makeArtifact(): TaskArtifactRecord {
  return {
    artifactId: 'artifact-1',
    taskId: 'task-1',
    threadId: 'thread-1',
    type: 'user_message',
    role: 'user',
    body: '用户确认执行。',
    metadata: {},
    attachments: [],
    createdAt: '2026-01-01T00:01:00.000Z',
  };
}

function renderDetail(snapshot = makeSnapshot()): string {
  return renderToStaticMarkup(
    <TaskDetail
      selected={snapshot}
      isNewTaskOpen={false}
      draft={draft}
      sortedArtifacts={[makeArtifact()]}
      messageBody=""
      messageAttachments={[]}
      messageExecutionMode="manual"
      messageRuntimeExecutionMode="auto"
      busyAction={null}
      onDraftChange={() => undefined}
      onDraftAttachmentsChange={() => undefined}
      onCreateTask={() => undefined}
      onMessageChange={() => undefined}
      onMessageAttachmentsChange={() => undefined}
      onMessageExecutionModeChange={() => undefined}
      onMessageRuntimeExecutionModeChange={() => undefined}
      onSubmitMessage={() => undefined}
      onCancelAgentRun={() => undefined}
      onAction={() => undefined}
    />,
  );
}

function countText(value: string, text: string): number {
  return value.split(text).length - 1;
}

describe('TaskDetail layout', () => {
  it('新增任务时展示执行位置下拉框', () => {
    const html = renderToStaticMarkup(
      <TaskDetail
        selected={null}
        isNewTaskOpen={true}
        draft={draft}
        selectedRepository={{
          fullName: 'ranwawa/along',
          owner: 'ranwawa',
          repo: 'along',
          path: '/workspace/along',
          isDefault: true,
        }}
        sortedArtifacts={[]}
        messageBody=""
        messageAttachments={[]}
        messageExecutionMode="manual"
        messageRuntimeExecutionMode="auto"
        busyAction={null}
        onDraftChange={() => undefined}
        onDraftAttachmentsChange={() => undefined}
        onCreateTask={() => undefined}
        onMessageChange={() => undefined}
        onMessageAttachmentsChange={() => undefined}
        onMessageExecutionModeChange={() => undefined}
        onMessageRuntimeExecutionModeChange={() => undefined}
        onSubmitMessage={() => undefined}
        onCancelAgentRun={() => undefined}
        onAction={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="执行位置"');
    expect(html).toContain('value="worktree"');
    expect(html).toContain('默认分支');
  });

  it('在中间滚动区顶部渲染固定 header 入口，并让右侧只保留状态图', () => {
    const html = renderDetail();

    expect(html).toContain('sticky top-0');
    expect(countText(html, '实时进展')).toBe(1);
    expect(countText(html, 'Agent 会话 Tail')).toBe(1);
    expect(countText(html, '任务元信息')).toBe(1);
    expect(countText(html, '历史流转')).toBe(1);
    expect(html).toContain('实现阶段正在执行');
    expect(html).not.toContain('运行前端测试');
    expect(html).not.toContain('进入实现阶段');
  });

  it('Agent 失败时在主内容区展示异常摘要', () => {
    const html = renderDetail(
      makeSnapshot({
        agentStages: [
          {
            stage: 'planning',
            agentId: 'planner',
            label: '计划阶段',
            status: 'failed',
            latestRun: {
              runId: 'run-1',
              taskId: 'task-1',
              threadId: 'thread-1',
              agentId: 'planner',
              runtimeId: 'codex',
              status: 'failed',
              inputArtifactIds: [],
              outputArtifactIds: [],
              error: 'Quota exceeded. Check your plan and billing details.',
              startedAt: '2026-01-01T00:01:00.000Z',
              endedAt: '2026-01-01T00:02:00.000Z',
            },
          },
        ],
      }),
    );

    expect(html).toContain('Agent 运行失败');
    expect(html).toContain('Quota exceeded');
  });
});

describe('TaskDetailDialog', () => {
  it('实时进展抽屉展示当前任务进展和失败态且不渲染遮罩', () => {
    const snapshot = makeSnapshot({
      agentProgressEvents: [
        {
          progressId: 'progress-failed',
          runId: 'run-1',
          taskId: 'task-1',
          threadId: 'thread-1',
          agentId: 'implementer',
          runtimeId: 'codex',
          phase: 'failed',
          summary: 'Agent 运行失败。',
          detail: '命令退出码 1',
          createdAt: '2026-01-01T00:04:00.000Z',
        },
      ],
    });

    const html = renderToStaticMarkup(
      <TaskDetailDialog
        kind="progress"
        selected={snapshot}
        onClose={() => undefined}
      />,
    );

    expect(html).toContain('实时进展');
    expect(html).toContain('fixed inset-y-0 right-0');
    expect(html).not.toContain('fixed inset-0 z-50 bg-black/45');
    expect(html).toContain('Agent 运行失败');
    expect(html).toContain('失败');
    expect(html).toContain('命令退出码 1');
  });

  it('实时进展抽屉默认使用更窄宽度并支持手动调整', () => {
    const html = renderToStaticMarkup(
      <TaskDetailDialog
        kind="progress"
        selected={makeSnapshot()}
        onClose={() => undefined}
      />,
    );

    expect(html).toContain('data-resizable-sheet="true"');
    expect(html).toContain('width:320px');
    expect(html).toContain('min-width:280px');
    expect(html).toContain('max-width:min(560px, calc(100vw - 280px))');
    expect(html).toContain('aria-label="调整抽屉宽度"');
  });

  it('Agent 会话 Tail 抽屉展示当前任务会话输出且不重复内部标题', () => {
    const html = renderToStaticMarkup(
      <TaskDetailDialog
        kind="tail"
        selected={makeSnapshot()}
        onClose={() => undefined}
      />,
    );

    expect(countText(html, 'Agent 会话 Tail')).toBe(1);
    expect(html).not.toContain('Codex 实时输出');
    expect(html).toContain('正在输出日志');
  });

  it('任务元信息和历史流转弹框复用当前任务数据', () => {
    const snapshot = makeSnapshot();
    const metadataHtml = renderToStaticMarkup(
      <TaskDetailDialog
        kind="metadata"
        selected={snapshot}
        onClose={() => undefined}
      />,
    );
    const historyHtml = renderToStaticMarkup(
      <TaskDetailDialog
        kind="history"
        selected={snapshot}
        onClose={() => undefined}
      />,
    );

    expect(metadataHtml).toContain('task-1');
    expect(metadataHtml).toContain('thread-1');
    expect(metadataHtml).toContain('人工确认');
    expect(historyHtml).toContain('历史流转');
    expect(historyHtml).toContain('进入实现阶段');
  });

  it('空内容弹框展示中文空态', () => {
    const snapshot = makeSnapshot({
      agentProgressEvents: [],
      agentSessionEvents: [],
      flow: { ...makeSnapshot().flow, events: [] },
    });

    const progressHtml = renderToStaticMarkup(
      <TaskDetailDialog
        kind="progress"
        selected={snapshot}
        onClose={() => undefined}
      />,
    );
    const historyHtml = renderToStaticMarkup(
      <TaskDetailDialog
        kind="history"
        selected={snapshot}
        onClose={() => undefined}
      />,
    );

    expect(progressHtml).toContain('暂无 Agent 运行进展');
    expect(historyHtml).toContain('暂无历史事件');
  });
});

describe('clampSheetWidth', () => {
  const options = {
    minWidth: 280,
    maxWidth: 560,
    minMainWidth: 280,
  };
  const desktopViewportWidth = 1280;
  const narrowViewportWidth = 760;
  const widthWithinBounds = 420;
  const widthBelowMinimum = 180;
  const widthAboveMaximum = 720;
  const expectedNarrowViewportMax = 480;

  it('允许抽屉在边界内拉宽和变窄', () => {
    expect(
      clampSheetWidth(widthWithinBounds, options, desktopViewportWidth),
    ).toBe(widthWithinBounds);
  });

  it('限制抽屉最小宽度', () => {
    expect(
      clampSheetWidth(widthBelowMinimum, options, desktopViewportWidth),
    ).toBe(options.minWidth);
  });

  it('限制抽屉最大宽度并保留主区域宽度', () => {
    expect(
      clampSheetWidth(widthAboveMaximum, options, desktopViewportWidth),
    ).toBe(options.maxWidth);
    expect(
      clampSheetWidth(options.maxWidth, options, narrowViewportWidth),
    ).toBe(expectedNarrowViewportMax);
  });
});
