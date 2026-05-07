import {
  TASK_LIFECYCLE,
  WORKFLOW_KIND,
  type WorkflowRuntimeState,
} from './task-workflow-state';

export type TaskDisplayState =
  | 'ask_active'
  | 'waiting_user'
  | 'ask_answered'
  | 'planning_drafting'
  | 'planning_awaiting_approval'
  | 'planning_feedback'
  | 'planning_planned'
  | 'implementation_implementing'
  | 'implementation_verifying'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'processing';

export interface TaskDisplay {
  state: TaskDisplayState;
  label: string;
}

export function deriveTaskDisplay(state: WorkflowRuntimeState): TaskDisplay {
  if (state.lifecycle === TASK_LIFECYCLE.CANCELLED) {
    return { state: 'cancelled', label: '已取消' };
  }
  if (state.lifecycle === TASK_LIFECYCLE.FAILED) {
    return { state: 'failed', label: '失败' };
  }
  if (state.lifecycle === TASK_LIFECYCLE.COMPLETED) {
    return { state: 'completed', label: '已完成' };
  }
  if (state.workflowState === 'waiting_user') {
    return { state: 'waiting_user', label: '待补充' };
  }
  if (state.currentWorkflowKind === WORKFLOW_KIND.ASK) {
    return state.workflowState === 'answered'
      ? { state: 'ask_answered', label: '已回答' }
      : { state: 'ask_active', label: '咨询中' };
  }
  if (state.currentWorkflowKind === WORKFLOW_KIND.PLANNING) {
    return derivePlanningDisplay(state);
  }
  if (state.currentWorkflowKind === WORKFLOW_KIND.IMPLEMENTATION) {
    return deriveImplementationDisplay(state);
  }
  return { state: 'processing', label: '处理中' };
}

function derivePlanningDisplay(state: WorkflowRuntimeState): TaskDisplay {
  if (state.workflowState === 'awaiting_approval') {
    return { state: 'planning_awaiting_approval', label: '待批准' };
  }
  if (state.workflowState === 'feedback') {
    return { state: 'planning_feedback', label: '计划反馈中' };
  }
  if (state.workflowState === 'planned') {
    return { state: 'planning_planned', label: '已规划' };
  }
  return { state: 'planning_drafting', label: '规划中' };
}

function deriveImplementationDisplay(state: WorkflowRuntimeState): TaskDisplay {
  if (state.workflowState === 'verifying') {
    return { state: 'implementation_verifying', label: '验证中' };
  }
  if (state.workflowState === 'completed') {
    return { state: 'planning_planned', label: '已规划' };
  }
  if (state.workflowState === 'failed') {
    return { state: 'failed', label: '失败' };
  }
  return { state: 'implementation_implementing', label: '实现中' };
}
