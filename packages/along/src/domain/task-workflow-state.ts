export const TASK_LIFECYCLE = {
  OPEN: 'open',
  WAITING_USER: 'waiting_user',
  READY: 'ready',
  RUNNING: 'running',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
} as const;

export type TaskLifecycle =
  (typeof TASK_LIFECYCLE)[keyof typeof TASK_LIFECYCLE];

export const WORKFLOW_KIND = {
  ASK: 'ask',
  PLANNING: 'planning',
  IMPLEMENTATION: 'implementation',
} as const;

export type WorkflowKind = (typeof WORKFLOW_KIND)[keyof typeof WORKFLOW_KIND];

export type AskWorkflowState = 'active' | 'waiting_user' | 'answered';
export type PlanningWorkflowState =
  | 'drafting'
  | 'waiting_user'
  | 'awaiting_approval'
  | 'feedback'
  | 'planned';
export type ImplementationWorkflowState =
  | 'implementing'
  | 'waiting_user'
  | 'verifying'
  | 'completed'
  | 'failed';
export type WorkflowState =
  | AskWorkflowState
  | PlanningWorkflowState
  | ImplementationWorkflowState;

export type DomainEventType =
  | 'task.created'
  | 'user.message.received'
  | 'ask.started'
  | 'ask.needs_user_input'
  | 'ask.answer.completed'
  | 'plan.requested'
  | 'plan.needs_user_input'
  | 'plan.revision.created'
  | 'feedback.round.opened'
  | 'feedback.round.resolved'
  | 'plan.approved'
  | 'implementation.started'
  | 'implementation.completed'
  | 'verification.started'
  | 'verification.passed'
  | 'implementation.failed'
  | 'task.closed';

export interface DomainEvent {
  type: DomainEventType;
  workflowKind?: WorkflowKind;
}

export interface WorkflowRuntimeState {
  lifecycle: TaskLifecycle;
  currentWorkflowKind: WorkflowKind;
  workflowState: WorkflowState;
}

type WorkflowPatch = Pick<WorkflowRuntimeState, 'lifecycle' | 'workflowState'>;

const TERMINAL_LIFECYCLES = new Set<TaskLifecycle>([
  TASK_LIFECYCLE.COMPLETED,
  TASK_LIFECYCLE.CANCELLED,
]);

function assertTransition(
  condition: boolean,
  event: DomainEventType,
): asserts condition {
  if (!condition) {
    throw new Error(`非法任务状态事件: ${event}`);
  }
}

export function reduceWorkflowEvent(
  state: WorkflowRuntimeState,
  event: DomainEvent,
): WorkflowRuntimeState {
  assertTransition(
    !TERMINAL_LIFECYCLES.has(state.lifecycle) || event.type === 'task.created',
    event.type,
  );
  if (event.type === 'task.created') return createInitialState(event);
  if (event.type === 'user.message.received') return state;
  if (event.type.startsWith('ask.')) return reduceAskEvent(state, event);
  if (event.type.startsWith('plan.') || event.type.startsWith('feedback.')) {
    return reducePlanningEvent(state, event);
  }
  if (
    event.type.startsWith('implementation.') ||
    event.type.startsWith('verification.')
  ) {
    return reduceImplementationEvent(state, event);
  }
  if (event.type === 'task.closed') {
    return { ...state, lifecycle: TASK_LIFECYCLE.CANCELLED };
  }
  return state;
}

function createInitialState(event: DomainEvent): WorkflowRuntimeState {
  const workflowKind = event.workflowKind || WORKFLOW_KIND.ASK;
  return workflowKind === WORKFLOW_KIND.PLANNING
    ? {
        lifecycle: TASK_LIFECYCLE.OPEN,
        currentWorkflowKind: WORKFLOW_KIND.PLANNING,
        workflowState: 'drafting',
      }
    : {
        lifecycle: TASK_LIFECYCLE.OPEN,
        currentWorkflowKind: WORKFLOW_KIND.ASK,
        workflowState: 'active',
      };
}

function reduceAskEvent(
  state: WorkflowRuntimeState,
  event: DomainEvent,
): WorkflowRuntimeState {
  switch (event.type) {
    case 'ask.started':
      return {
        lifecycle: TASK_LIFECYCLE.OPEN,
        currentWorkflowKind: WORKFLOW_KIND.ASK,
        workflowState: 'active',
      };
    case 'ask.needs_user_input':
      assertTransition(
        state.currentWorkflowKind === WORKFLOW_KIND.ASK,
        event.type,
      );
      return {
        ...state,
        lifecycle: TASK_LIFECYCLE.WAITING_USER,
        workflowState: 'waiting_user',
      };
    case 'ask.answer.completed':
      assertTransition(
        state.currentWorkflowKind === WORKFLOW_KIND.ASK,
        event.type,
      );
      return {
        ...state,
        lifecycle: TASK_LIFECYCLE.READY,
        workflowState: 'answered',
      };
    default:
      return state;
  }
}

function reducePlanningEvent(
  state: WorkflowRuntimeState,
  event: DomainEvent,
): WorkflowRuntimeState {
  if (event.type === 'plan.requested') {
    return {
      lifecycle: TASK_LIFECYCLE.OPEN,
      currentWorkflowKind: WORKFLOW_KIND.PLANNING,
      workflowState: 'drafting',
    };
  }
  assertTransition(
    state.currentWorkflowKind === WORKFLOW_KIND.PLANNING,
    event.type,
  );
  const patch = PLANNING_EVENT_PATCHES[event.type];
  return patch ? { ...state, ...patch } : state;
}

function reduceImplementationEvent(
  state: WorkflowRuntimeState,
  event: DomainEvent,
): WorkflowRuntimeState {
  if (event.type === 'implementation.started') {
    return {
      lifecycle: TASK_LIFECYCLE.RUNNING,
      currentWorkflowKind: WORKFLOW_KIND.IMPLEMENTATION,
      workflowState: 'implementing',
    };
  }
  assertTransition(
    state.currentWorkflowKind === WORKFLOW_KIND.IMPLEMENTATION,
    event.type,
  );
  const patch = IMPLEMENTATION_EVENT_PATCHES[event.type];
  return patch ? { ...state, ...patch } : state;
}

const PLANNING_EVENT_PATCHES: Partial<Record<DomainEventType, WorkflowPatch>> =
  {
    'plan.needs_user_input': {
      lifecycle: TASK_LIFECYCLE.WAITING_USER,
      workflowState: 'waiting_user',
    },
    'plan.revision.created': {
      lifecycle: TASK_LIFECYCLE.WAITING_USER,
      workflowState: 'awaiting_approval',
    },
    'feedback.round.opened': {
      lifecycle: TASK_LIFECYCLE.OPEN,
      workflowState: 'feedback',
    },
    'feedback.round.resolved': {
      lifecycle: TASK_LIFECYCLE.WAITING_USER,
      workflowState: 'awaiting_approval',
    },
    'plan.approved': {
      lifecycle: TASK_LIFECYCLE.READY,
      workflowState: 'planned',
    },
  };

const IMPLEMENTATION_EVENT_PATCHES: Partial<
  Record<DomainEventType, WorkflowPatch>
> = {
  'implementation.completed': {
    lifecycle: TASK_LIFECYCLE.READY,
    workflowState: 'completed',
  },
  'verification.started': {
    lifecycle: TASK_LIFECYCLE.RUNNING,
    workflowState: 'verifying',
  },
  'verification.passed': {
    lifecycle: TASK_LIFECYCLE.COMPLETED,
    workflowState: 'completed',
  },
  'implementation.failed': {
    lifecycle: TASK_LIFECYCLE.FAILED,
    workflowState: 'failed',
  },
};
