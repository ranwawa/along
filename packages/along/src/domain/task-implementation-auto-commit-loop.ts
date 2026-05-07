import { buildAutoCommitFixPrompt } from '../agents/task-implementation';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import { runTaskAgentTurn } from './task-agent-runtime';
import { runTaskAutoCommit } from './task-auto-commit';
import type { TaskAutoCommitFailure } from './task-auto-commit-types';
import type {
  RunTaskImplementationAgentInput,
  RunTaskImplementationAgentOutput,
} from './task-implementation-agent';
import {
  readTaskPlanningSnapshot,
  TASK_LIFECYCLE,
  type TaskPlanningSnapshot,
  type TaskPlanRevisionRecord,
  THREAD_STATUS,
  updateTaskWorkflowState,
  WORKFLOW_KIND,
} from './task-planning';
import type {
  PrepareTaskWorktreeOutput,
  TaskWorktreeCommandRunner,
} from './task-worktree';

type AutoCommitAttemptResult =
  | Result<RunTaskImplementationAgentOutput>
  | {
      success: false;
      error: string;
      snapshot: TaskPlanningSnapshot;
      failure: TaskAutoCommitFailure;
    };

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
  const rollbackRes = updateTaskWorkflowState({
    taskId,
    lifecycle: TASK_LIFECYCLE.READY,
    currentWorkflowKind: WORKFLOW_KIND.PLANNING,
    threadStatus: THREAD_STATUS.APPROVED,
  });
  return rollbackRes.success ? result : failure<T>(rollbackRes.error);
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

export async function runAutoCommitLoop(input: {
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
