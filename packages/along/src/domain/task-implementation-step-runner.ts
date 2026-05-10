import { buildImplementationStepsPrompt } from '../agents/task-implementation';
import { failure } from '../core/result';
import { runTaskAgentTurn } from './task-agent-runtime';
import type { RunTaskImplementationAgentInput } from './task-implementation-agent';
import {
  BUILDER_TACTICAL_PLAN_ROLE,
  IMPLEMENTATION_STEPS_KIND,
} from './task-implementation-steps';
import type {
  TaskPlanningSnapshot,
  TaskPlanRevisionRecord,
} from './task-planning';

export async function runImplementationStepsTurn(input: {
  taskInput: RunTaskImplementationAgentInput;
  snapshot: TaskPlanningSnapshot;
  approvedPlan: TaskPlanRevisionRecord;
  agentId: string;
}) {
  const result = await runTaskAgentTurn({
    taskId: input.taskInput.taskId,
    threadId: input.snapshot.thread.threadId,
    agentId: input.agentId,
    prompt: buildImplementationStepsPrompt(input.snapshot, input.approvedPlan),
    cwd: input.taskInput.cwd,
    modelId: input.taskInput.modelId,
    personalityVersion: input.taskInput.personalityVersion,
    inputArtifactIds: [
      input.approvedPlan.artifactId,
      ...input.snapshot.artifacts.map((artifact) => artifact.artifactId),
    ],
    outputMetadata: {
      kind: IMPLEMENTATION_STEPS_KIND,
      artifactRole: BUILDER_TACTICAL_PLAN_ROLE,
      planId: input.approvedPlan.planId,
      planVersion: input.approvedPlan.version,
    },
    codexOptions: {
      sandboxMode: 'read-only',
      approvalPolicy: 'on-request',
    },
    options: {
      permissionMode: 'plan',
      maxTurns: 20,
    },
  });
  if (result.success && result.data.run.status === 'cancelled') {
    return failure('Implementation Steps Agent Run 已取消');
  }
  return result;
}
