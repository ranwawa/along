import { buildExecStepsPrompt } from '../../agents/task-exec';
import { failure } from '../../core/result';
import type { TaskPlanningSnapshot, TaskPlanRevisionRecord } from '../planning';
import { runTaskAgentTurn } from './agent-runtime';
import type { RunTaskExecAgentInput } from './exec-agent';
import { EXEC_STEPS_KIND, EXECUTOR_TACTICAL_PLAN_ROLE } from './exec-steps';

export async function runExecStepsTurn(input: {
  taskInput: RunTaskExecAgentInput;
  snapshot: TaskPlanningSnapshot;
  approvedPlan: TaskPlanRevisionRecord;
  agentId: string;
}) {
  const result = await runTaskAgentTurn({
    taskId: input.taskInput.taskId,
    threadId: input.snapshot.thread.threadId,
    agentId: input.agentId,
    prompt: buildExecStepsPrompt(input.snapshot, input.approvedPlan),
    cwd: input.taskInput.cwd,
    modelId: input.taskInput.modelId,
    personalityVersion: input.taskInput.personalityVersion,
    inputArtifactIds: [
      input.approvedPlan.artifactId,
      ...input.snapshot.artifacts.map((artifact) => artifact.artifactId),
    ],
    outputMetadata: {
      kind: EXEC_STEPS_KIND,
      artifactRole: EXECUTOR_TACTICAL_PLAN_ROLE,
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
    return failure('Exec Steps Agent Run 已取消');
  }
  return result;
}
