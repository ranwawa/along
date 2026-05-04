import { buildImplementationStepsPrompt } from '../agents/task-implementation';
import { runTaskAgentTurn } from './task-agent-runtime';
import type { RunTaskImplementationAgentInput } from './task-implementation-agent';
import { IMPLEMENTATION_STEPS_KIND } from './task-implementation-steps';
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
  return runTaskAgentTurn({
    taskId: input.taskInput.taskId,
    threadId: input.snapshot.thread.threadId,
    agentId: input.agentId,
    prompt: buildImplementationStepsPrompt(input.snapshot, input.approvedPlan),
    cwd: input.taskInput.cwd,
    editor: input.taskInput.editor,
    model: input.taskInput.model,
    personalityVersion: input.taskInput.personalityVersion,
    inputArtifactIds: [
      input.approvedPlan.artifactId,
      ...input.snapshot.artifacts.map((artifact) => artifact.artifactId),
    ],
    outputMetadata: {
      kind: IMPLEMENTATION_STEPS_KIND,
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
}
