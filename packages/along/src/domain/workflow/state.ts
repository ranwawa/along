export const LIFECYCLE = {
  ACTIVE: 'active',
  WAITING: 'waiting',
  DONE: 'done',
  FAILED: 'failed',
} as const;

export type Lifecycle = (typeof LIFECYCLE)[keyof typeof LIFECYCLE];

export const RESOLUTION = {
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export type Resolution = (typeof RESOLUTION)[keyof typeof RESOLUTION];

export const WORKFLOW_KIND = {
  CHAT: 'chat',
  PLAN: 'plan',
  EXEC: 'exec',
} as const;

export type WorkflowKind = (typeof WORKFLOW_KIND)[keyof typeof WORKFLOW_KIND];

export type ChatWorkflowState = 'discussing';
export type PlanWorkflowState = 'drafting' | 'awaiting_approval' | 'revising';
export type ExecWorkflowState = 'implementing' | 'verifying' | 'implemented';
export type WorkflowState =
  | ChatWorkflowState
  | PlanWorkflowState
  | ExecWorkflowState;

export type DomainEventType =
  | 'task.activated'
  | 'chat.replied'
  | 'chat.escalated'
  | 'plan.draft_completed'
  | 'plan.feedback_submitted'
  | 'plan.revision_completed'
  | 'plan.approved'
  | 'exec.completed'
  | 'exec.verified'
  | 'task.accepted'
  | 'task.failed'
  | 'task.cancelled'
  | 'task.retried'
  | 'recovery.interrupted';

export interface DomainEvent {
  type: DomainEventType;
  workflowKind?: WorkflowKind;
}

export interface WorkflowRuntimeState {
  lifecycle: Lifecycle;
  currentWorkflowKind: WorkflowKind;
  workflowState: WorkflowState;
  resolution?: Resolution;
}

function assertTransition(
  condition: boolean,
  event: DomainEventType,
): asserts condition {
  if (!condition) {
    throw new Error(`非法任务状态事件: ${event}`);
  }
}

export function reduceWorkflowEvent(
  state: WorkflowRuntimeState | null,
  event: DomainEvent,
): WorkflowRuntimeState {
  if (event.type === 'task.activated') {
    return activateWorkflow(event.workflowKind ?? WORKFLOW_KIND.PLAN);
  }

  assertTransition(state !== null, event.type);

  if (event.type === 'recovery.interrupted') {
    return reduceRecovery(state);
  }

  assertTransition(state.lifecycle !== LIFECYCLE.DONE, event.type);

  return reduceActiveWorkflowEvent(state, event);
}

function activateWorkflow(kind: WorkflowKind): WorkflowRuntimeState {
  if (kind === WORKFLOW_KIND.CHAT) {
    return {
      lifecycle: LIFECYCLE.ACTIVE,
      currentWorkflowKind: WORKFLOW_KIND.CHAT,
      workflowState: 'discussing',
    };
  }
  return kind === WORKFLOW_KIND.EXEC
    ? {
        lifecycle: LIFECYCLE.ACTIVE,
        currentWorkflowKind: WORKFLOW_KIND.EXEC,
        workflowState: 'implementing',
      }
    : {
        lifecycle: LIFECYCLE.ACTIVE,
        currentWorkflowKind: WORKFLOW_KIND.PLAN,
        workflowState: 'drafting',
      };
}

function reduceActiveWorkflowEvent(
  state: WorkflowRuntimeState,
  event: DomainEvent,
): WorkflowRuntimeState {
  if (event.type === 'task.cancelled') {
    return {
      ...state,
      lifecycle: LIFECYCLE.DONE,
      resolution: RESOLUTION.CANCELLED,
    };
  }

  if (event.type === 'task.failed') {
    return { ...state, lifecycle: LIFECYCLE.FAILED };
  }

  if (event.type === 'task.retried') {
    assertTransition(state.lifecycle === LIFECYCLE.FAILED, event.type);
    return { ...state, lifecycle: LIFECYCLE.ACTIVE, resolution: undefined };
  }

  if (event.type.startsWith('chat.')) {
    return reduceChatEvent(state, event);
  }

  if (event.type.startsWith('plan.')) {
    return reducePlanEvent(state, event);
  }

  if (event.type.startsWith('exec.')) {
    return reduceExecEvent(state, event);
  }

  if (event.type === 'task.accepted') {
    assertTransition(state.workflowState === 'implemented', event.type);
    return {
      ...state,
      lifecycle: LIFECYCLE.DONE,
      resolution: RESOLUTION.COMPLETED,
    };
  }

  return state;
}

function reduceChatEvent(
  state: WorkflowRuntimeState,
  event: DomainEvent,
): WorkflowRuntimeState {
  switch (event.type) {
    case 'chat.replied':
      assertTransition(state.workflowState === 'discussing', event.type);
      return state;
    case 'chat.escalated':
      assertTransition(state.workflowState === 'discussing', event.type);
      return {
        lifecycle: LIFECYCLE.ACTIVE,
        currentWorkflowKind: WORKFLOW_KIND.PLAN,
        workflowState: 'drafting',
      };
    default:
      return state;
  }
}

function reducePlanEvent(
  state: WorkflowRuntimeState,
  event: DomainEvent,
): WorkflowRuntimeState {
  switch (event.type) {
    case 'plan.draft_completed':
      assertTransition(state.workflowState === 'drafting', event.type);
      return {
        ...state,
        lifecycle: LIFECYCLE.WAITING,
        workflowState: 'awaiting_approval',
      };
    case 'plan.feedback_submitted':
      assertTransition(state.workflowState === 'awaiting_approval', event.type);
      return {
        ...state,
        lifecycle: LIFECYCLE.ACTIVE,
        workflowState: 'revising',
      };
    case 'plan.revision_completed':
      assertTransition(state.workflowState === 'revising', event.type);
      return {
        ...state,
        lifecycle: LIFECYCLE.WAITING,
        workflowState: 'awaiting_approval',
      };
    case 'plan.approved':
      assertTransition(state.workflowState === 'awaiting_approval', event.type);
      return {
        lifecycle: LIFECYCLE.ACTIVE,
        currentWorkflowKind: WORKFLOW_KIND.EXEC,
        workflowState: 'implementing',
      };
    default:
      return state;
  }
}

function reduceExecEvent(
  state: WorkflowRuntimeState,
  event: DomainEvent,
): WorkflowRuntimeState {
  switch (event.type) {
    case 'exec.completed':
      assertTransition(state.workflowState === 'implementing', event.type);
      return {
        ...state,
        lifecycle: LIFECYCLE.ACTIVE,
        workflowState: 'verifying',
      };
    case 'exec.verified':
      assertTransition(state.workflowState === 'verifying', event.type);
      return {
        ...state,
        lifecycle: LIFECYCLE.WAITING,
        workflowState: 'implemented',
      };
    default:
      return state;
  }
}

function reduceRecovery(state: WorkflowRuntimeState): WorkflowRuntimeState {
  if (state.lifecycle !== LIFECYCLE.ACTIVE) return state;
  return { ...state, lifecycle: LIFECYCLE.FAILED };
}
