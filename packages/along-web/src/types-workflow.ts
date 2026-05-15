export type TaskLifecycle = 'active' | 'waiting' | 'done' | 'failed';

export type WorkflowKind = 'plan' | 'exec';

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
