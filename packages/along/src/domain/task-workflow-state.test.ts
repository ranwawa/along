import { describe, expect, it } from 'vitest';
import { deriveTaskDisplay } from './task-display-state';
import {
  reduceWorkflowEvent,
  TASK_LIFECYCLE,
  WORKFLOW_KIND,
  type WorkflowRuntimeState,
} from './task-workflow-state';

describe('task-workflow-state', () => {
  it('创建任务默认进入 ask workflow', () => {
    const state = reduceWorkflowEvent(
      {
        lifecycle: TASK_LIFECYCLE.OPEN,
        currentWorkflowKind: WORKFLOW_KIND.ASK,
        workflowState: 'active',
      },
      { type: 'task.created' },
    );

    expect(state).toEqual({
      lifecycle: 'open',
      currentWorkflowKind: 'ask',
      workflowState: 'active',
    });
    expect(deriveTaskDisplay(state)).toEqual({
      state: 'ask_active',
      label: '咨询中',
    });
  });

  it('user.message.received 不直接改变状态', () => {
    const state: WorkflowRuntimeState = {
      lifecycle: TASK_LIFECYCLE.READY,
      currentWorkflowKind: WORKFLOW_KIND.ASK,
      workflowState: 'answered',
    };

    expect(reduceWorkflowEvent(state, { type: 'user.message.received' })).toBe(
      state,
    );
  });

  it('ask 可以通过 plan.requested 切换到 planning', () => {
    const state = reduceWorkflowEvent(
      {
        lifecycle: TASK_LIFECYCLE.READY,
        currentWorkflowKind: WORKFLOW_KIND.ASK,
        workflowState: 'answered',
      },
      { type: 'plan.requested' },
    );

    expect(state).toEqual({
      lifecycle: 'open',
      currentWorkflowKind: 'planning',
      workflowState: 'drafting',
    });
  });

  it('planning 审批后进入 ready/planned', () => {
    const drafted = reduceWorkflowEvent(
      {
        lifecycle: TASK_LIFECYCLE.OPEN,
        currentWorkflowKind: WORKFLOW_KIND.PLANNING,
        workflowState: 'drafting',
      },
      { type: 'plan.revision.created' },
    );
    const approved = reduceWorkflowEvent(drafted, { type: 'plan.approved' });

    expect(approved).toEqual({
      lifecycle: 'ready',
      currentWorkflowKind: 'planning',
      workflowState: 'planned',
    });
    expect(deriveTaskDisplay(approved).label).toBe('已规划');
  });

  it('拒绝 workflow 不匹配的非法事件', () => {
    expect(() =>
      reduceWorkflowEvent(
        {
          lifecycle: TASK_LIFECYCLE.OPEN,
          currentWorkflowKind: WORKFLOW_KIND.ASK,
          workflowState: 'active',
        },
        { type: 'plan.revision.created' },
      ),
    ).toThrow('非法任务状态事件');
  });
});
