import { buildImplementationPrompt } from '../agents/task-implementation';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import { runTaskAgentTurn } from './task-agent-runtime';
import { runAutoCommitLoop } from './task-implementation-auto-commit-loop';
import { runImplementationStepsTurn } from './task-implementation-step-runner';
import {
  areImplementationStepsApproved,
  findImplementationStepsArtifact,
} from './task-implementation-steps';
import {
  PLAN_STATUS,
  readTaskPlanningSnapshot,
  TASK_LIFECYCLE,
  type TaskPlanningSnapshot,
  type TaskPlanRevisionRecord,
  transitionTaskWorkflow,
  WORKFLOW_KIND,
} from './task-planning';
import {
  defaultTaskWorktreeCommandRunner,
  type PrepareTaskWorktreeOutput,
  prepareTaskWorktree,
  type TaskWorktreeCommandRunner,
} from './task-worktree';

export interface RunTaskImplementationAgentInput {
  taskId: string;
  agentId?: string;
  cwd: string;
  modelId?: string;
  personalityVersion?: string;
  commandRunner?: TaskWorktreeCommandRunner;
  readDefaultBranch?: (repoPath: string) => Promise<Result<string>>;
}

export interface RunTaskImplementationAgentOutput {
  snapshot: TaskPlanningSnapshot;
  approvedPlan: TaskPlanRevisionRecord;
  assistantText: string;
  commitShas: string[];
}

interface PreparedImplementationRun {
  snapshot: TaskPlanningSnapshot;
  approvedPlan: TaskPlanRevisionRecord;
  worktree: PrepareTaskWorktreeOutput;
}

interface ApprovedImplementationContext {
  snapshot: TaskPlanningSnapshot;
  approvedPlan: TaskPlanRevisionRecord;
}

function findApprovedPlan(
  snapshot: TaskPlanningSnapshot,
): TaskPlanRevisionRecord | null {
  if (!snapshot.thread.approvedPlanId) return null;
  return (
    snapshot.plans.find(
      (plan) =>
        plan.planId === snapshot.thread.approvedPlanId &&
        plan.status === PLAN_STATUS.APPROVED,
    ) || null
  );
}

async function readRequiredSnapshot(
  taskId: string,
  message: string,
): Promise<Result<TaskPlanningSnapshot>> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return snapshotRes;
  if (!snapshotRes.data) return failure(message);
  return success(snapshotRes.data);
}

function rollbackToPlanningApproved<T>(taskId: string, result: Result<T>) {
  const rollbackRes = transitionTaskWorkflow({
    taskId,
    event: { type: 'recovery.interrupted' },
  });
  return rollbackRes.success ? result : failure<T>(rollbackRes.error);
}

async function runImplementationTurn(input: {
  taskInput: RunTaskImplementationAgentInput;
  snapshot: TaskPlanningSnapshot;
  approvedPlan: TaskPlanRevisionRecord;
  worktree: PrepareTaskWorktreeOutput;
  agentId: string;
}) {
  return runTaskAgentTurn({
    taskId: input.taskInput.taskId,
    threadId: input.snapshot.thread.threadId,
    agentId: input.agentId,
    prompt: buildImplementationPrompt(
      input.snapshot,
      input.approvedPlan,
      input.worktree.worktreePath,
    ),
    cwd: input.worktree.worktreePath,
    modelId: input.taskInput.modelId,
    personalityVersion: input.taskInput.personalityVersion,
    inputArtifactIds: [
      input.approvedPlan.artifactId,
      ...input.snapshot.artifacts.map((artifact) => artifact.artifactId),
    ],
    options: {
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 80,
    },
  });
}

async function prepareImplementationRun(
  input: RunTaskImplementationAgentInput,
  commandRunner: TaskWorktreeCommandRunner,
): Promise<Result<PreparedImplementationRun>> {
  const contextRes = readApprovedImplementationContext(input.taskId);
  if (!contextRes.success) return failure(contextRes.error);
  const { snapshot, approvedPlan } = contextRes.data;

  if (!areImplementationStepsApproved(snapshot, approvedPlan)) {
    const steps = findImplementationStepsArtifact(snapshot, approvedPlan);
    return failure(
      steps
        ? '实施步骤已产出，等待人工确认后才能开始编码'
        : '当前 Task 还没有实施步骤，不能开始编码',
    );
  }

  const worktreeRes = await prepareTaskWorktree({
    snapshot,
    repoPath: input.cwd,
    commandRunner,
    readDefaultBranch: input.readDefaultBranch,
  });
  if (!worktreeRes.success) return failure(worktreeRes.error);

  const startedRes = transitionTaskWorkflow({
    taskId: input.taskId,
    event: { type: 'implementation.started' },
  });
  if (!startedRes.success) return failure(startedRes.error);

  return success({ snapshot, approvedPlan, worktree: worktreeRes.data });
}

function readApprovedImplementationContext(
  taskId: string,
): Result<ApprovedImplementationContext> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return failure(snapshotRes.error);
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${taskId}`);
  if (snapshot.task.lifecycle === TASK_LIFECYCLE.CANCELLED) {
    return failure('Task 已关闭，不能开始实现');
  }

  const approvedPlan = findApprovedPlan(snapshot);
  if (!approvedPlan) return failure('当前 Task 没有已批准方案，不能开始实现');
  if (
    snapshot.task.currentWorkflowKind !== WORKFLOW_KIND.PLANNING &&
    snapshot.task.currentWorkflowKind !== WORKFLOW_KIND.IMPLEMENTATION
  ) {
    return failure('当前 Task 工作流不能开始实现');
  }

  return success({ snapshot, approvedPlan });
}

async function runInitialImplementationStepsIfNeeded(
  input: RunTaskImplementationAgentInput,
  context: ApprovedImplementationContext,
  agentId: string,
): Promise<Result<RunTaskImplementationAgentOutput | null>> {
  if (findImplementationStepsArtifact(context.snapshot, context.approvedPlan)) {
    return success(null);
  }

  const stepsResult = await runImplementationStepsTurn({
    taskInput: input,
    snapshot: context.snapshot,
    approvedPlan: context.approvedPlan,
    agentId,
  });
  if (!stepsResult.success) return failure(stepsResult.error);
  const refreshed = await readRequiredSnapshot(
    input.taskId,
    `Task ${input.taskId} 已产出实施步骤，但读取快照失败`,
  );
  if (!refreshed.success) return failure(refreshed.error);
  return success({
    snapshot: refreshed.data,
    approvedPlan: context.approvedPlan,
    assistantText: stepsResult.data.assistantText,
    commitShas: [],
  });
}

async function runConfirmedImplementation(input: {
  taskInput: RunTaskImplementationAgentInput;
  agentId: string;
  commandRunner: TaskWorktreeCommandRunner;
}): Promise<Result<RunTaskImplementationAgentOutput>> {
  const prepared = await prepareImplementationRun(
    input.taskInput,
    input.commandRunner,
  );
  if (!prepared.success) return prepared;

  const result = await runImplementationTurn({
    taskInput: input.taskInput,
    snapshot: prepared.data.snapshot,
    approvedPlan: prepared.data.approvedPlan,
    worktree: prepared.data.worktree,
    agentId: input.agentId,
  });

  if (!result.success) {
    return rollbackToPlanningApproved(input.taskInput.taskId, result);
  }
  if (result.data.run.status === 'cancelled') {
    return rollbackToPlanningApproved(
      input.taskInput.taskId,
      failure('Implementation Agent Run 已取消'),
    );
  }

  return runAutoCommitLoop({
    taskInput: input.taskInput,
    approvedPlan: prepared.data.approvedPlan,
    worktree: prepared.data.worktree,
    agentId: input.agentId,
    commandRunner: input.commandRunner,
    assistantText: result.data.assistantText,
  });
}

export async function runTaskImplementationAgent(
  input: RunTaskImplementationAgentInput,
): Promise<Result<RunTaskImplementationAgentOutput>> {
  const commandRunner = input.commandRunner || defaultTaskWorktreeCommandRunner;
  const context = readApprovedImplementationContext(input.taskId);
  if (!context.success) return context;

  const agentId = input.agentId || 'implementer';
  const stepsResult = await runInitialImplementationStepsIfNeeded(
    input,
    context.data,
    agentId,
  );
  if (!stepsResult.success) return stepsResult;
  if (stepsResult.data) return success(stepsResult.data);

  return runConfirmedImplementation({
    taskInput: input,
    agentId,
    commandRunner,
  });
}
