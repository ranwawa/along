import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TaskPlanningSnapshot } from '../types';
import { TaskProgressPanel } from './TaskProgressPanel';

const NOW = Date.parse('2026-01-01T00:05:00.000Z');

function makeTask(): TaskPlanningSnapshot['task'] {
  return {
    taskId: 'task-1',
    title: '观察 agent 实时进展',
    body: '希望看到 agent 当前在做什么。',
    source: 'test',
    status: 'implementing',
    commitShas: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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
    agentStages: [],
    flow: {
      currentStageId: 'implementation',
      conclusion: '实现阶段正在执行。',
      severity: 'normal',
      stages: [],
      actions: [],
      blockers: [],
      events: [],
    },
    ...overrides,
  };
}

function renderPanel(snapshot: TaskPlanningSnapshot): string {
  return renderToStaticMarkup(
    <TaskProgressPanel snapshot={snapshot} nowMs={NOW} />,
  );
}

function makeProgressEvent(
  overrides: Partial<TaskPlanningSnapshot['agentProgressEvents'][number]>,
): TaskPlanningSnapshot['agentProgressEvents'][number] {
  return {
    progressId: 'prog-1',
    runId: 'run-1',
    taskId: 'task-1',
    threadId: 'thread-1',
    agentId: 'implementer',
    provider: 'codex',
    phase: 'tool',
    summary: '正在执行命令。',
    createdAt: '2026-01-01T00:04:30.000Z',
    ...overrides,
  };
}

describe('TaskProgressPanel empty', () => {
  it('无进展时渲染空状态', () => {
    const html = renderPanel(makeSnapshot());
    expect(html).toContain('暂无 Agent 运行进展');
  });
});

describe('TaskProgressPanel progress event', () => {
  it('渲染实时进展列表', () => {
    const html = renderPanel(
      makeSnapshot({
        agentProgressEvents: [makeProgressEvent({ detail: '运行局部测试。' })],
      }),
    );
    expect(html).toContain('Along 编排状态');
    expect(html).toContain('正在执行命令');
    expect(html).toContain('运行局部测试');
  });

  it('渲染失败状态', () => {
    const html = renderPanel(
      makeSnapshot({
        agentProgressEvents: [
          makeProgressEvent({
            phase: 'failed',
            summary: 'Agent 运行失败，正在记录错误。',
            detail: '命令退出码 1',
            createdAt: '2026-01-01T00:04:00.000Z',
          }),
        ],
      }),
    );
    expect(html).toContain('失败');
    expect(html).toContain('命令退出码 1');
  });
});

describe('TaskProgressPanel session tail', () => {
  it('渲染 Agent session 会话流', () => {
    const html = renderPanel(
      makeSnapshot({
        agentRuns: [makeRunningRun()],
        agentSessionEvents: [
          {
            eventId: 'sess-1',
            runId: 'run-1',
            taskId: 'task-1',
            threadId: 'thread-1',
            agentId: 'implementer',
            provider: 'codex',
            source: 'agent',
            kind: 'output',
            content: '正在修改 TaskProgressPanel。',
            metadata: {},
            createdAt: '2026-01-01T00:04:50.000Z',
          },
        ],
      }),
    );
    expect(html).toContain('Agent 会话 Tail');
    expect(html).toContain('Codex 实时输出');
    expect(html).toContain('正在修改 TaskProgressPanel');
  });

  it('渲染 Codex 多来源会话事件', () => {
    const html = renderPanel(
      makeSnapshot({
        agentSessionEvents: [
          makeSessionEvent({
            eventId: 'sess-system',
            source: 'system',
            kind: 'progress',
            content: 'Codex 已开始处理本轮请求。',
          }),
          makeSessionEvent({
            eventId: 'sess-tool',
            source: 'tool',
            kind: 'message',
            content: '开始执行命令。',
          }),
          makeSessionEvent({
            eventId: 'sess-stdout',
            source: 'stdout',
            kind: 'output',
            content: 'test passed',
          }),
          makeSessionEvent({
            eventId: 'sess-stderr',
            source: 'stderr',
            kind: 'error',
            content: 'command failed',
          }),
        ],
      }),
    );
    expect(html).toContain('System / codex');
    expect(html).toContain('Tool / codex');
    expect(html).toContain('stdout / codex');
    expect(html).toContain('stderr / codex');
    expect(html).toContain('command failed');
  });

  it('运行中但无会话输出时渲染可观测提示', () => {
    const html = renderPanel(
      makeSnapshot({
        agentRuns: [makeRunningRun()],
      }),
    );
    expect(html).toContain('正在等待第一条 Codex 实时输出');
  });
});

describe('TaskProgressPanel stale run', () => {
  it('长时间无新事件时渲染仍在执行提示', () => {
    const html = renderPanel(
      makeSnapshot({
        agentRuns: [makeRunningRun()],
        agentProgressEvents: [
          makeProgressEvent({
            phase: 'waiting',
            summary: 'Agent 正在执行任务。',
            createdAt: '2026-01-01T00:01:00.000Z',
          }),
        ],
      }),
    );
    expect(html).toContain('仍在执行');
    expect(html).toContain('最近一次进展');
  });
});

function makeRunningRun(): TaskPlanningSnapshot['agentRuns'][number] {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    threadId: 'thread-1',
    agentId: 'implementer',
    provider: 'codex',
    status: 'running',
    inputArtifactIds: [],
    outputArtifactIds: [],
    startedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeSessionEvent(
  overrides: Partial<TaskPlanningSnapshot['agentSessionEvents'][number]>,
): TaskPlanningSnapshot['agentSessionEvents'][number] {
  return {
    eventId: 'sess-1',
    runId: 'run-1',
    taskId: 'task-1',
    threadId: 'thread-1',
    agentId: 'implementer',
    provider: 'codex',
    source: 'agent',
    kind: 'output',
    content: '正在处理。',
    metadata: {},
    createdAt: '2026-01-01T00:04:50.000Z',
    ...overrides,
  };
}
