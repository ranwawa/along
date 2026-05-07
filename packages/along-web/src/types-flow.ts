export type TaskFlowStageId =
  | 'ask'
  | 'requirements'
  | 'plan_discussion'
  | 'plan_confirmation'
  | 'implementation'
  | 'delivery'
  | 'completed';

export type TaskFlowStageState =
  | 'pending'
  | 'current'
  | 'completed'
  | 'blocked'
  | 'attention';

export type TaskFlowActionId =
  | 'submit_feedback'
  | 'request_plan'
  | 'approve_plan'
  | 'request_revision'
  | 'rerun_planner'
  | 'start_implementation'
  | 'confirm_implementation_steps'
  | 'resume_failed_stage'
  | 'copy_resume_command'
  | 'manual_complete'
  | 'start_delivery'
  | 'accept_delivery'
  | 'request_changes'
  | 'close_task';

export type TaskFlowEventType =
  | 'task_created'
  | 'user_feedback'
  | 'plan_revision'
  | 'plan_approved'
  | 'implementation_steps_approved'
  | 'feedback_round'
  | 'agent_run_started'
  | 'agent_run_succeeded'
  | 'agent_run_failed'
  | 'agent_run_cancelled'
  | 'delivery_updated'
  | 'task_completed'
  | 'task_closed';

export interface TaskFlowAction {
  id: TaskFlowActionId;
  label: string;
  description: string;
  enabled: boolean;
  disabledReason?: string;
  stage: TaskFlowStageId;
  variant: 'primary' | 'secondary' | 'danger';
}

export interface TaskFlowStage {
  id: TaskFlowStageId;
  label: string;
  summary: string;
  state: TaskFlowStageState;
  blocker?: string;
  details: string[];
  startedAt?: string;
  endedAt?: string;
}

export interface TaskFlowEvent {
  eventId: string;
  type: TaskFlowEventType;
  stage: TaskFlowStageId;
  title: string;
  summary?: string;
  occurredAt: string;
}

export interface TaskFlowSnapshot {
  currentStageId: TaskFlowStageId;
  conclusion: string;
  severity: 'normal' | 'warning' | 'blocked' | 'success';
  stages: TaskFlowStage[];
  actions: TaskFlowAction[];
  blockers: string[];
  events: TaskFlowEvent[];
}
