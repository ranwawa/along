import { LIFECYCLE, WORKFLOW_KIND, type WorkflowRuntimeState } from './state';

export type TaskDisplayState =
  | 'plan_drafting'
  | 'plan_awaiting_approval'
  | 'plan_revising'
  | 'exec_implementing'
  | 'exec_verifying'
  | 'exec_implemented'
  | 'done'
  | 'failed';

export interface TaskDisplay {
  state: TaskDisplayState;
  label: string;
}

export function deriveTaskDisplay(state: WorkflowRuntimeState): TaskDisplay {
  if (state.lifecycle === LIFECYCLE.DONE) {
    return {
      state: 'done',
      label: state.resolution === 'cancelled' ? '已取消' : '已完成',
    };
  }
  if (state.lifecycle === LIFECYCLE.FAILED) {
    return { state: 'failed', label: '失败' };
  }
  if (state.currentWorkflowKind === WORKFLOW_KIND.PLAN) {
    return derivePlanDisplay(state);
  }
  return deriveExecDisplay(state);
}

function derivePlanDisplay(state: WorkflowRuntimeState): TaskDisplay {
  switch (state.workflowState) {
    case 'awaiting_approval':
      return { state: 'plan_awaiting_approval', label: '待批准' };
    case 'revising':
      return { state: 'plan_revising', label: '方案修改中' };
    default:
      return { state: 'plan_drafting', label: '规划中' };
  }
}

function deriveExecDisplay(state: WorkflowRuntimeState): TaskDisplay {
  switch (state.workflowState) {
    case 'verifying':
      return { state: 'exec_verifying', label: '验证中' };
    case 'implemented':
      return { state: 'exec_implemented', label: '待验收' };
    default:
      return { state: 'exec_implementing', label: '实现中' };
  }
}
