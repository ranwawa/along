import { buildExecPrompt } from '../../agents/task-exec';
import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import {
  LIFECYCLE,
  PLAN_STATUS,
  readTaskPlanningSnapshot,
  TASK_AGENT_ID,
  type TaskPlanningSnapshot,
  type TaskPlanRevisionRecord,
  transitionTaskWorkflow,
  WORKFLOW_KIND,
} from '../planning';
import {
  defaultTaskWorktreeCommandRunner,
  type PrepareTaskWorktreeOutput,
  prepareTaskWorktree,
  type TaskWorktreeCommandRunner,
} from '../worktree';
import { runTaskAgentTurn } from './agent-runtime';
import { runAutoCommitLoop } from './exec-auto-commit-loop';
import { runExecStepsTurn } from './exec-step-runner';
import { areExecStepsApproved, findExecStepsArtifact } from './exec-steps';
import {
  loadProductionContract,
  type ProductionContract,
} from './verification-gate';
import { runVerificationLoop } from './verification-loop';

export interface RunTaskExecAgentInput {
  taskId: string;
  agentId?: string;
  cwd: string;
  modelId?: string;
  personalityVersion?: string;
  commandRunner?: TaskWorktreeCommandRunner;
  readDefaultBranch?: (repoPath: string) => Promise<Result<string>>;
}

export interface RunTaskExecAgentOutput {
  snapshot: TaskPlanningSnapshot;
  approvedPlan: TaskPlanRevisionRecord;
  assistantText: string;
  commitShas: string[];
}

interface PreparedExecRun {
  snapshot: TaskPlanningSnapshot;
  approvedPlan: TaskPlanRevisionRecord;
  worktree: PrepareTaskWorktreeOutput;
  productionContract: ProductionContract;
}

interface ApprovedExecContext {
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

async function runExecTurn(input: {
  taskInput: RunTaskExecAgentInput;
  snapshot: TaskPlanningSnapshot;
  approvedPlan: TaskPlanRevisionRecord;
  worktree: PrepareTaskWorktreeOutput;
  agentId: string;
}) {
  return runTaskAgentTurn({
    taskId: input.taskInput.taskId,
    threadId: input.snapshot.thread.threadId,
    agentId: input.agentId,
    prompt: buildExecPrompt(
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

async function loadRequiredProductionContract(
  worktree: PrepareTaskWorktreeOutput,
  commandRunner: TaskWorktreeCommandRunner,
): Promise<Result<ProductionContract>> {
  return loadProductionContract(
    worktree.worktreePath,
    worktree.defaultBranch,
    commandRunner,
  );
}

async function prepareExecRun(
  input: RunTaskExecAgentInput,
  commandRunner: TaskWorktreeCommandRunner,
): Promise<Result<PreparedExecRun>> {
  const contextRes = readApprovedExecContext(input.taskId);
  if (!contextRes.success) return failure(contextRes.error);
  const { snapshot, approvedPlan } = contextRes.data;

  if (!areExecStepsApproved(snapshot, approvedPlan)) {
    const steps = findExecStepsArtifact(snapshot, approvedPlan);
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

  const contractRes = await loadRequiredProductionContract(
    worktreeRes.data,
    commandRunner,
  );
  if (!contractRes.success) return failure(contractRes.error);

  const startedRes = transitionTaskWorkflow({
    taskId: input.taskId,
    event: { type: 'exec.started' },
  });
  if (!startedRes.success) return failure(startedRes.error);

  return success({
    snapshot,
    approvedPlan,
    worktree: worktreeRes.data,
    productionContract: contractRes.data,
  });
}

function readApprovedExecContext(taskId: string): Result<ApprovedExecContext> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return failure(snapshotRes.error);
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${taskId}`);
  if (snapshot.task.lifecycle === LIFECYCLE.DONE) {
    return failure('Task 已关闭，不能开始实现');
  }

  const approvedPlan = findApprovedPlan(snapshot);
  if (!approvedPlan) return failure('当前 Task 没有已批准方案，不能开始实现');
  if (
    snapshot.task.currentWorkflowKind !== WORKFLOW_KIND.PLAN &&
    snapshot.task.currentWorkflowKind !== WORKFLOW_KIND.EXEC
  ) {
    return failure('当前 Task 工作流不能开始实现');
  }

  return success({ snapshot, approvedPlan });
}

async function runInitialExecStepsIfNeeded(
  input: RunTaskExecAgentInput,
  context: ApprovedExecContext,
  agentId: string,
): Promise<Result<RunTaskExecAgentOutput | null>> {
  if (findExecStepsArtifact(context.snapshot, context.approvedPlan)) {
    return success(null);
  }

  const stepsResult = await runExecStepsTurn({
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

async function commitAndVerify(input: {
  taskInput: RunTaskExecAgentInput;
  prepared: PreparedExecRun;
  agentId: string;
  commandRunner: TaskWorktreeCommandRunner;
  assistantText: string;
}): Promise<Result<RunTaskExecAgentOutput>> {
  const commitResult = await runAutoCommitLoop({
    taskInput: input.taskInput,
    approvedPlan: input.prepared.approvedPlan,
    worktree: input.prepared.worktree,
    agentId: input.agentId,
    commandRunner: input.commandRunner,
    assistantText: input.assistantText,
  });
  if (!commitResult.success) return commitResult;

  return runVerificationLoop({
    taskInput: input.taskInput,
    snapshot: commitResult.data.snapshot,
    approvedPlan: input.prepared.approvedPlan,
    worktree: input.prepared.worktree,
    agentId: input.agentId,
    commandRunner: input.commandRunner,
    assistantText: commitResult.data.assistantText,
    commitShas: commitResult.data.commitShas,
    productionContract: input.prepared.productionContract,
  });
}

async function runConfirmedExec(input: {
  taskInput: RunTaskExecAgentInput;
  agentId: string;
  commandRunner: TaskWorktreeCommandRunner;
}): Promise<Result<RunTaskExecAgentOutput>> {
  const prepared = await prepareExecRun(input.taskInput, input.commandRunner);
  if (!prepared.success) return prepared;

  const result = await runExecTurn({
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
      failure('Exec Agent Run 已取消'),
    );
  }

  return commitAndVerify({
    taskInput: input.taskInput,
    prepared: prepared.data,
    agentId: input.agentId,
    commandRunner: input.commandRunner,
    assistantText: result.data.assistantText,
  });
}

export async function runTaskExecAgent(
  input: RunTaskExecAgentInput,
): Promise<Result<RunTaskExecAgentOutput>> {
  const commandRunner = input.commandRunner || defaultTaskWorktreeCommandRunner;
  const context = readApprovedExecContext(input.taskId);
  if (!context.success) return context;

  const agentId = input.agentId || TASK_AGENT_ID.EXEC;
  const stepsResult = await runInitialExecStepsIfNeeded(
    input,
    context.data,
    agentId,
  );
  if (!stepsResult.success) return stepsResult;
  if (stepsResult.data) return success(stepsResult.data);

  return runConfirmedExec({
    taskInput: input,
    agentId,
    commandRunner,
  });
}
