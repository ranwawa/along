import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TaskFlowSnapshot, TaskPlanRevisionRecord } from '../types';
import { CurrentPlanDialog, TaskFlowPanel } from './TaskFlowPanel';

function makeFlow(overrides: Partial<TaskFlowSnapshot> = {}): TaskFlowSnapshot {
  return {
    currentStageId: 'delivery',
    conclusion: '结果已交付，等待验收或继续修改。',
    severity: 'success',
    blockers: [],
    events: [],
    stages: [
      {
        id: 'delivery',
        label: '结果交付',
        summary: '结果已交付',
        state: 'current',
        details: ['PR：https://example.com/pr/1'],
      },
      {
        id: 'completed',
        label: '已完成',
        summary: '等待验收',
        state: 'pending',
        details: [],
      },
    ],
    actions: [
      {
        id: 'accept_delivery',
        label: '验收完成',
        description: '确认交付结果并结束任务',
        enabled: true,
        stage: 'delivery',
        variant: 'primary',
      },
    ],
    ...overrides,
  };
}

function makePlan(): TaskPlanRevisionRecord {
  return {
    planId: 'plan-1',
    taskId: 'task-1',
    threadId: 'thread-1',
    version: 1,
    status: 'active',
    artifactId: 'artifact-1',
    body: '## 方案\n\n先实现右侧面板调整。',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('TaskFlowPanel', () => {
  it('默认展开当前阶段并显示已交付验收按钮', () => {
    const html = renderToStaticMarkup(
      <TaskFlowPanel
        flow={makeFlow()}
        currentPlan={null}
        busyAction={null}
        onAction={() => undefined}
      />,
    );

    expect(html).toContain('结果已交付');
    expect(html).toContain('验收完成');
  });

  it('在计划确认阶段提供当前计划入口', () => {
    const html = renderToStaticMarkup(
      <TaskFlowPanel
        flow={makeFlow({
          currentStageId: 'plan_confirmation',
          conclusion: '等待你确认计划。',
          stages: [
            {
              id: 'plan_confirmation',
              label: '计划确认',
              summary: '等待用户确认',
              state: 'current',
              details: ['当前计划：v1'],
            },
          ],
          actions: [],
        })}
        currentPlan={makePlan()}
        busyAction={null}
        onAction={() => undefined}
      />,
    );

    expect(html).toContain('查看计划 v1');
    expect(html).toContain('计划确认');
  });

  it('当前计划抽屉使用 Markdown 渲染计划正文且不渲染遮罩', () => {
    const html = renderToStaticMarkup(
      <CurrentPlanDialog
        plan={makePlan()}
        open={true}
        onClose={() => undefined}
      />,
    );

    expect(html).toContain('当前计划 v1');
    expect(html).toContain('fixed inset-y-0 right-0');
    expect(html).not.toContain('fixed inset-0 z-50 bg-black/45');
    expect(html).toContain('<h2');
    expect(html).toContain('方案');
  });

  it('当前计划抽屉默认使用更窄宽度并支持手动调整', () => {
    const html = renderToStaticMarkup(
      <CurrentPlanDialog
        plan={makePlan()}
        open={true}
        onClose={() => undefined}
      />,
    );

    expect(html).toContain('data-resizable-sheet="true"');
    expect(html).toContain('width:320px');
    expect(html).toContain('min-width:280px');
    expect(html).toContain('max-width:min(640px, calc(100vw - 280px))');
    expect(html).toContain('aria-label="调整抽屉宽度"');
  });
});
