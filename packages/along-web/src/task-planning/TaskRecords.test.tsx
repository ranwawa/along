import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TaskArtifactRecord } from '../types';
import {
  getReadableArtifacts,
  isDuplicatePlannerAgentResult,
  TaskRecordsPanel,
} from './TaskRecords';

function makeArtifact(
  overrides: Partial<TaskArtifactRecord> = {},
): TaskArtifactRecord {
  return {
    artifactId: 'artifact-1',
    taskId: 'task-1',
    threadId: 'thread-1',
    type: 'user_message',
    role: 'user',
    body: '用户消息',
    metadata: {},
    attachments: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('TaskRecords', () => {
  it('隐藏 planner 已发布为计划的结构化 agent_result', () => {
    const hidden = makeArtifact({
      artifactId: 'hidden',
      type: 'agent_result',
      role: 'agent',
      body: JSON.stringify({ action: 'plan_revision', body: '正式计划' }),
      metadata: { agentId: 'planner' },
    });
    const visiblePlan = makeArtifact({
      artifactId: 'plan',
      type: 'plan_revision',
      role: 'agent',
      body: '## 正式计划',
      metadata: { agentId: 'planner', version: 1 },
    });

    expect(isDuplicatePlannerAgentResult(hidden)).toBe(true);
    expect(getReadableArtifacts([hidden, visiblePlan])).toEqual([visiblePlan]);
  });

  it('保留 planning_update、实施步骤和不可解析的 agent_result', () => {
    const update = makeArtifact({
      artifactId: 'update',
      type: 'planning_update',
      role: 'agent',
      body: '补充说明',
      metadata: { agentId: 'planner' },
    });
    const steps = makeArtifact({
      artifactId: 'steps',
      type: 'agent_result',
      role: 'agent',
      body: '已完成只读核对，实施步骤如下。',
      metadata: { agentId: 'implementer', kind: 'implementation_steps' },
    });
    const rawPlannerResult = makeArtifact({
      artifactId: 'raw',
      type: 'agent_result',
      role: 'agent',
      body: '不是 JSON',
      metadata: { agentId: 'planner' },
    });

    expect(getReadableArtifacts([update, steps, rawPlannerResult])).toEqual([
      update,
      steps,
      rawPlannerResult,
    ]);
  });

  it('渲染过滤后的过程记录和细分标签', () => {
    const html = renderToStaticMarkup(
      <TaskRecordsPanel
        artifacts={[
          makeArtifact({
            artifactId: 'hidden',
            type: 'agent_result',
            role: 'agent',
            body: JSON.stringify({ action: 'planning_update', body: '重复' }),
            metadata: { agentId: 'planner' },
          }),
          makeArtifact({
            artifactId: 'steps',
            type: 'agent_result',
            role: 'agent',
            body: '**实施步骤**',
            metadata: { agentId: 'implementer', kind: 'implementation_steps' },
          }),
        ]}
      />,
    );

    expect(html).not.toContain('planning_update');
    expect(html).toContain('实施步骤');
    expect(html).toContain('<strong>实施步骤</strong>');
  });
});
