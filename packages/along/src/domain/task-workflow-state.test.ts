import { describe, expect, it } from 'vitest';
import {
  LIFECYCLE,
  reduceWorkflowEvent,
  WORKFLOW_KIND,
  type WorkflowRuntimeState,
} from './task-workflow-state';

describe('task-workflow-state', () => {
  describe('task.activated', () => {
    it('默认进入 plan/drafting', () => {
      const state = reduceWorkflowEvent(null, { type: 'task.activated' });
      expect(state).toEqual({
        lifecycle: 'active',
        currentWorkflowKind: 'plan',
        workflowState: 'drafting',
      });
    });

    it('指定 exec 直接进入 implementing', () => {
      const state = reduceWorkflowEvent(null, {
        type: 'task.activated',
        workflowKind: WORKFLOW_KIND.EXEC,
      });
      expect(state).toEqual({
        lifecycle: 'active',
        currentWorkflowKind: 'exec',
        workflowState: 'implementing',
      });
    });
  });

  describe('plan 阶段', () => {
    const drafting: WorkflowRuntimeState = {
      lifecycle: LIFECYCLE.ACTIVE,
      currentWorkflowKind: WORKFLOW_KIND.PLAN,
      workflowState: 'drafting',
    };

    it('draft_completed → awaiting_approval/waiting', () => {
      const state = reduceWorkflowEvent(drafting, {
        type: 'plan.draft_completed',
      });
      expect(state).toEqual({
        lifecycle: 'waiting',
        currentWorkflowKind: 'plan',
        workflowState: 'awaiting_approval',
      });
    });

    it('feedback_submitted → revising/active', () => {
      const awaiting: WorkflowRuntimeState = {
        ...drafting,
        lifecycle: LIFECYCLE.WAITING,
        workflowState: 'awaiting_approval',
      };
      const state = reduceWorkflowEvent(awaiting, {
        type: 'plan.feedback_submitted',
      });
      expect(state).toEqual({
        lifecycle: 'active',
        currentWorkflowKind: 'plan',
        workflowState: 'revising',
      });
    });

    it('revision_completed → awaiting_approval/waiting', () => {
      const revising: WorkflowRuntimeState = {
        ...drafting,
        workflowState: 'revising',
      };
      const state = reduceWorkflowEvent(revising, {
        type: 'plan.revision_completed',
      });
      expect(state).toEqual({
        lifecycle: 'waiting',
        currentWorkflowKind: 'plan',
        workflowState: 'awaiting_approval',
      });
    });

    it('approved → exec/implementing/active', () => {
      const awaiting: WorkflowRuntimeState = {
        ...drafting,
        lifecycle: LIFECYCLE.WAITING,
        workflowState: 'awaiting_approval',
      };
      const state = reduceWorkflowEvent(awaiting, { type: 'plan.approved' });
      expect(state).toEqual({
        lifecycle: 'active',
        currentWorkflowKind: 'exec',
        workflowState: 'implementing',
      });
    });
  });

  describe('exec 阶段', () => {
    const implementing: WorkflowRuntimeState = {
      lifecycle: LIFECYCLE.ACTIVE,
      currentWorkflowKind: WORKFLOW_KIND.EXEC,
      workflowState: 'implementing',
    };

    it('completed → verifying/active', () => {
      const state = reduceWorkflowEvent(implementing, {
        type: 'exec.completed',
      });
      expect(state).toEqual({
        lifecycle: 'active',
        currentWorkflowKind: 'exec',
        workflowState: 'verifying',
      });
    });

    it('verified → implemented/waiting', () => {
      const verifying: WorkflowRuntimeState = {
        ...implementing,
        workflowState: 'verifying',
      };
      const state = reduceWorkflowEvent(verifying, { type: 'exec.verified' });
      expect(state).toEqual({
        lifecycle: 'waiting',
        currentWorkflowKind: 'exec',
        workflowState: 'implemented',
      });
    });

    it('task.accepted → done/completed', () => {
      const implemented: WorkflowRuntimeState = {
        ...implementing,
        lifecycle: LIFECYCLE.WAITING,
        workflowState: 'implemented',
      };
      const state = reduceWorkflowEvent(implemented, { type: 'task.accepted' });
      expect(state).toEqual({
        lifecycle: 'done',
        currentWorkflowKind: 'exec',
        workflowState: 'implemented',
        resolution: 'completed',
      });
    });
  });

  describe('通用事件', () => {
    const active: WorkflowRuntimeState = {
      lifecycle: LIFECYCLE.ACTIVE,
      currentWorkflowKind: WORKFLOW_KIND.EXEC,
      workflowState: 'implementing',
    };

    it('task.failed → failed', () => {
      const state = reduceWorkflowEvent(active, { type: 'task.failed' });
      expect(state.lifecycle).toBe('failed');
    });

    it('task.cancelled → done(cancelled)', () => {
      const state = reduceWorkflowEvent(active, { type: 'task.cancelled' });
      expect(state).toMatchObject({
        lifecycle: 'done',
        resolution: 'cancelled',
      });
    });

    it('task.retried 从 failed 恢复', () => {
      const failed: WorkflowRuntimeState = {
        ...active,
        lifecycle: LIFECYCLE.FAILED,
      };
      const state = reduceWorkflowEvent(failed, { type: 'task.retried' });
      expect(state.lifecycle).toBe('active');
    });

    it('task.retried 非 failed 状态抛错', () => {
      expect(() =>
        reduceWorkflowEvent(active, { type: 'task.retried' }),
      ).toThrow('非法任务状态事件');
    });

    it('done 状态拒绝所有非 activated 事件', () => {
      const done: WorkflowRuntimeState = {
        ...active,
        lifecycle: LIFECYCLE.DONE,
        resolution: 'completed',
      };
      expect(() => reduceWorkflowEvent(done, { type: 'task.failed' })).toThrow(
        '非法任务状态事件',
      );
    });

    it('recovery.interrupted 在 active 时转为 failed', () => {
      const state = reduceWorkflowEvent(active, {
        type: 'recovery.interrupted',
      });
      expect(state.lifecycle).toBe('failed');
    });

    it('recovery.interrupted 在非 active 时不变', () => {
      const waiting: WorkflowRuntimeState = {
        ...active,
        lifecycle: LIFECYCLE.WAITING,
        workflowState: 'implemented',
      };
      const state = reduceWorkflowEvent(waiting, {
        type: 'recovery.interrupted',
      });
      expect(state).toEqual(waiting);
    });
  });

  describe('guards', () => {
    it('plan 事件在错误 workflowState 时抛错', () => {
      const revising: WorkflowRuntimeState = {
        lifecycle: LIFECYCLE.ACTIVE,
        currentWorkflowKind: WORKFLOW_KIND.PLAN,
        workflowState: 'revising',
      };
      expect(() =>
        reduceWorkflowEvent(revising, { type: 'plan.draft_completed' }),
      ).toThrow('非法任务状态事件');
    });

    it('exec 事件在错误 workflowState 时抛错', () => {
      const verifying: WorkflowRuntimeState = {
        lifecycle: LIFECYCLE.ACTIVE,
        currentWorkflowKind: WORKFLOW_KIND.EXEC,
        workflowState: 'verifying',
      };
      expect(() =>
        reduceWorkflowEvent(verifying, { type: 'exec.completed' }),
      ).toThrow('非法任务状态事件');
    });

    it('task.accepted 在非 implemented 时抛错', () => {
      const implementing: WorkflowRuntimeState = {
        lifecycle: LIFECYCLE.ACTIVE,
        currentWorkflowKind: WORKFLOW_KIND.EXEC,
        workflowState: 'implementing',
      };
      expect(() =>
        reduceWorkflowEvent(implementing, { type: 'task.accepted' }),
      ).toThrow('非法任务状态事件');
    });
  });
});
