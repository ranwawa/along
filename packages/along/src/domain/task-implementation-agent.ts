import {
  buildAutoCommitFixPrompt,
  buildImplementationPrompt,
} from '../agents/task-implementation';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import { runTaskAgentTurn } from './task-agent-runtime';
import { runTaskAutoCommit } from './task-auto-commit';
import type { TaskAutoCommitFailure } from './task-auto-commit-types';
import {
  PLAN_STATUS,
  readTaskPlanningSnapshot,
  TASK_STATUS,
  type TaskPlanningSnapshot,
  type TaskPlanRevisionRecord,
  updateTaskStatus,
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
  editor?: string;
  model?: string;
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

type AutoCommitAttemptResult =
  | Result<RunTaskImplementationAgentOutput>
  | {
      success: false;
      error: string;
      snapshot: TaskPlanningSnapshot;
      failure: TaskAutoCommitFailure;
    };

interface PreparedImplementationRun {
  snapshot: TaskPlanningSnapshot;
  approvedPlan: TaskPlanRevisionRecord;
  worktree: PrepareTaskWorktreeOutput;
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
  const rollbackRes = updateTaskStatus(taskId, TASK_STATUS.PLANNING_APPROVED);
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
    editor: input.taskInput.editor,
    model: input.taskInput.model,
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

async function runAutoCommitFixTurn(input: {
  taskInput: RunTaskImplementationAgentInput;
  snapshot: TaskPlanningSnapshot;
  approvedPlan: TaskPlanRevisionRecord;
  worktree: PrepareTaskWorktreeOutput;
  agentId: string;
  failure: TaskAutoCommitFailure;
  attempt: number;
  maxAttempts: number;
}) {
  return runTaskAgentTurn({
    taskId: input.taskInput.taskId,
    threadId: input.snapshot.thread.threadId,
    agentId: input.agentId,
    prompt: buildAutoCommitFixPrompt({
      snapshot: input.snapshot,
      approvedPlan: input.approvedPlan,
      worktreePath: input.worktree.worktreePath,
      failure: input.failure,
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
    }),
    cwd: input.worktree.worktreePath,
    editor: input.taskInput.editor,
    model: input.taskInput.model,
    personalityVersion: input.taskInput.personalityVersion,
    inputArtifactIds: [
      input.approvedPlan.artifactId,
      ...input.snapshot.artifacts.map((artifact) => artifact.artifactId),
      ...(input.failure.failureArtifactId
        ? [input.failure.failureArtifactId]
        : []),
    ],
    options: {
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 40,
    },
  });
}

async function runAutoCommitLoop(input: {
  taskInput: RunTaskImplementationAgentInput;
  approvedPlan: TaskPlanRevisionRecord;
  worktree: PrepareTaskWorktreeOutput;
  agentId: string;
  commandRunner: TaskWorktreeCommandRunner;
  assistantText: string;
}): Promise<Result<RunTaskImplementationAgentOutput>> {
  let assistantText = input.assistantText;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptRes = await runAutoCommitAttempt(input, assistantText);
    if (attemptRes.success) return attemptRes;
    if (!('failure' in attemptRes)) return attemptRes;
    if (attempt === maxAttempts) {
      return rollbackToPlanningApproved(
        input.taskInput.taskId,
        failure(attemptRes.error),
      );
    }
    const fixResult = await runAutoCommitFixTurn({
      ...input,
      snapshot: attemptRes.snapshot,
      failure: attemptRes.failure,
      attempt: attempt + 1,
      maxAttempts,
    });
    if (!fixResult.success) {
      return rollbackToPlanningApproved(input.taskInput.taskId, fixResult);
    }
    assistantText = fixResult.data.assistantText;
  }
  return failure('auto-commit 状态异常');
}

async function runAutoCommitAttempt(
  input: {
    taskInput: RunTaskImplementationAgentInput;
    approvedPlan: TaskPlanRevisionRecord;
    worktree: PrepareTaskWorktreeOutput;
    commandRunner: TaskWorktreeCommandRunner;
  },
  assistantText: string,
): Promise<AutoCommitAttemptResult> {
  const snapshotRes = await readRequiredSnapshot(
    input.taskInput.taskId,
    `Task ${input.taskInput.taskId} 实现完成，但 auto-commit 前读取快照失败`,
  );
  if (!snapshotRes.success) return snapshotRes;

  const commitRes = await runTaskAutoCommit({
    snapshot: snapshotRes.data,
    worktreePath: input.worktree.worktreePath,
    branchName: input.worktree.branchName,
    defaultBranch: input.worktree.defaultBranch,
    commandRunner: input.commandRunner,
    assistantText,
  });
  if (!commitRes.success) {
    return {
      success: false,
      error: `auto-commit 失败: ${commitRes.error}`,
      snapshot: snapshotRes.data,
      failure: commitRes,
    };
  }

  const refreshed = await readRequiredSnapshot(
    input.taskInput.taskId,
    `Task ${input.taskInput.taskId} 已实现并提交，但读取快照失败`,
  );
  if (!refreshed.success) return refreshed;
  return success({
    snapshot: refreshed.data,
    approvedPlan: input.approvedPlan,
    assistantText,
    commitShas: commitRes.data.commitShas,
  });
}

async function prepareImplementationRun(
  input: RunTaskImplementationAgentInput,
  commandRunner: TaskWorktreeCommandRunner,
): Promise<Result<PreparedImplementationRun>> {
  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success) return failure(snapshotRes.error);
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${input.taskId}`);

  const approvedPlan = findApprovedPlan(snapshot);
  if (!approvedPlan) return failure('当前 Task 没有已批准方案，不能开始实现');
  if (
    snapshot.task.status !== TASK_STATUS.PLANNING_APPROVED &&
    snapshot.task.status !== TASK_STATUS.IMPLEMENTING
  ) {
    return failure(`当前 Task 状态不能开始实现: ${snapshot.task.status}`);
  }

  const worktreeRes = await prepareTaskWorktree({
    snapshot,
    repoPath: input.cwd,
    commandRunner,
    readDefaultBranch: input.readDefaultBranch,
  });
  if (!worktreeRes.success) return failure(worktreeRes.error);

  const startedRes = updateTaskStatus(input.taskId, TASK_STATUS.IMPLEMENTING);
  if (!startedRes.success) return failure(startedRes.error);

  return success({ snapshot, approvedPlan, worktree: worktreeRes.data });
}

export async function runTaskImplementationAgent(
  input: RunTaskImplementationAgentInput,
): Promise<Result<RunTaskImplementationAgentOutput>> {
  const commandRunner = input.commandRunner || defaultTaskWorktreeCommandRunner;
  const prepared = await prepareImplementationRun(input, commandRunner);
  if (!prepared.success) return prepared;

  const agentId = input.agentId || 'implementer';
  const result = await runImplementationTurn({
    taskInput: input,
    snapshot: prepared.data.snapshot,
    approvedPlan: prepared.data.approvedPlan,
    worktree: prepared.data.worktree,
    agentId,
  });

  if (!result.success) {
    return rollbackToPlanningApproved(input.taskId, result);
  }

  return runAutoCommitLoop({
    taskInput: input,
    approvedPlan: prepared.data.approvedPlan,
    worktree: prepared.data.worktree,
    agentId,
    commandRunner,
    assistantText: result.data.assistantText,
  });
}
