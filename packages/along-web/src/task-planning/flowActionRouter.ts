import type {
  TaskAgentStageRecord,
  TaskFlowAction,
  TaskFlowActionId,
} from '../types';
import type { UseTaskPlanningActionsInput } from './actionTypes';
import { getLatestFailedStage } from './format';

export type FlowActionParts = {
  submitMessageFromFlow: () => Promise<void>;
  copyManualResumeCommand: (stage: TaskAgentStageRecord) => Promise<void>;
  completeManualStage: (stage: TaskAgentStageRecord) => Promise<void>;
  runSimpleAction: (
    actionKey: string,
    path: string,
    canRun: boolean,
  ) => Promise<void>;
};

export function runFlowAction(
  action: TaskFlowAction,
  input: UseTaskPlanningActionsInput,
  actions: FlowActionParts,
) {
  const failedStage = input.selected
    ? getLatestFailedStage(input.selected)
    : null;
  if (action.id === 'submit_feedback') void actions.submitMessageFromFlow();
  else if (action.id === 'request_revision')
    void actions.submitMessageFromFlow();
  else if (action.id === 'request_changes')
    void actions.submitMessageFromFlow();
  else if (action.id === 'copy_resume_command' && failedStage) {
    void actions.copyManualResumeCommand(failedStage);
  } else if (action.id === 'resume_failed_stage' && failedStage) {
    void resumeFailedStage(failedStage, actions.runSimpleAction);
  } else if (action.id === 'manual_complete' && failedStage) {
    void actions.completeManualStage(failedStage);
  } else runStageAction(action.id, input, actions.runSimpleAction);
}

function resumeFailedStage(
  stage: TaskAgentStageRecord,
  runSimpleAction: FlowActionParts['runSimpleAction'],
) {
  const pathByStage: Record<TaskAgentStageRecord['stage'], string> = {
    planning: 'planner',
    implementation: 'implementation',
    delivery: 'delivery',
  };
  runSimpleAction(`resume-${stage.stage}`, pathByStage[stage.stage], true);
}

function runStageAction(
  id: TaskFlowActionId,
  input: UseTaskPlanningActionsInput,
  runSimpleAction: FlowActionParts['runSimpleAction'],
) {
  if (id === 'approve_plan')
    runSimpleAction('approve', 'approve', input.canApprove);
  if (id === 'rerun_planner') runSimpleAction('planner', 'planner', true);
  if (id === 'start_implementation') {
    runSimpleAction('implementation', 'implementation', input.canImplement);
  }
  if (id === 'start_delivery') {
    runSimpleAction('delivery', 'delivery', input.canDeliver);
  }
  if (id === 'accept_delivery') {
    runSimpleAction('accept_delivery', 'complete', true);
  }
}
