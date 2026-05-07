export type TaskLifecycle =
  | 'open'
  | 'waiting_user'
  | 'ready'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type WorkflowKind = 'ask' | 'planning' | 'implementation';

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
