import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import {
  AGENT_RUN_STATUS,
  createTaskAgentRun,
  finishTaskAgentRun,
  readTaskPlanningSnapshot,
  recordTaskAgentResult,
  TASK_WORKSPACE_MODE,
  type TaskPlanningSnapshot,
  transitionTaskWorkflow,
  updateTaskDelivery,
} from '../planning';
import {
  collectDeliveryCommits,
  type DeliveryContext,
  failDeliveryRun,
  prepareDeliveryWorktree,
  pushDeliveryBranch,
  validateDeliveryPreconditions,
} from './helpers';
import { createDeliveryPr } from './pr';

export type {
  RunTaskDeliveryInput,
  RunTaskDeliveryOutput,
  TaskDeliveryCommandOptions,
  TaskDeliveryCommandRunner,
} from './helpers';

import type { RunTaskDeliveryInput, RunTaskDeliveryOutput } from './helpers';

function checkAlreadyDelivered(
  snapshot: TaskPlanningSnapshot,
): RunTaskDeliveryOutput | null {
  if (snapshot.task.prUrl) {
    return {
      snapshot,
      branchName: snapshot.task.branchName || '',
      commitShas: snapshot.task.commitShas,
      prUrl: snapshot.task.prUrl,
      prNumber: snapshot.task.prNumber,
    };
  }
  if (
    snapshot.task.workspaceMode === TASK_WORKSPACE_MODE.DEFAULT_BRANCH &&
    snapshot.task.status === 'delivered'
  ) {
    return {
      snapshot,
      branchName: snapshot.task.branchName || '',
      commitShas: snapshot.task.commitShas,
    };
  }
  return null;
}

async function finishRunAndRefresh(
  ctx: DeliveryContext,
  branchName: string,
  commitShas: string[],
  prUrl?: string,
  prNumber?: number,
): Promise<Result<RunTaskDeliveryOutput>> {
  const finishedRes = finishTaskAgentRun({
    runId: ctx.run.runId,
    status: AGENT_RUN_STATUS.SUCCEEDED,
  });
  if (!finishedRes.success) return finishedRes;
  const refreshed = readTaskPlanningSnapshot(ctx.input.taskId);
  if (!refreshed.success) return refreshed;
  if (!refreshed.data)
    return failure(`Task ${ctx.input.taskId} 已交付，但读取快照失败`);
  return success({
    snapshot: refreshed.data,
    branchName,
    commitShas,
    prUrl,
    prNumber,
  });
}

async function finalizeDelivery(
  ctx: DeliveryContext,
  branchName: string,
  commitShas: string[],
  resultBody: string,
  prUrl?: string,
  prNumber?: number,
): Promise<Result<RunTaskDeliveryOutput>> {
  const deliveryRes = updateTaskDelivery({
    taskId: ctx.input.taskId,
    branchName,
    commitShas,
    prUrl,
    prNumber,
  });
  if (!deliveryRes.success) return failDeliveryRun(ctx, deliveryRes.error);
  const wfRes = transitionTaskWorkflow({
    taskId: ctx.input.taskId,
    event: { type: 'task.accepted' },
  });
  if (!wfRes.success) return failDeliveryRun(ctx, wfRes.error);
  recordTaskAgentResult({
    taskId: ctx.input.taskId,
    threadId: ctx.snapshot.thread.threadId,
    agentId: 'delivery',
    runtimeId: 'system',
    body: resultBody,
  });
  return finishRunAndRefresh(ctx, branchName, commitShas, prUrl, prNumber);
}

async function finalizeDefaultBranchDelivery(
  ctx: DeliveryContext,
  branchName: string,
  finalCommitSha: string,
): Promise<Result<RunTaskDeliveryOutput>> {
  const body = [
    'Delivery 完成：已推送默认分支。',
    '',
    `- 分支：${branchName}`,
    `- Commit：${finalCommitSha}`,
  ].join('\n');
  return finalizeDelivery(ctx, branchName, [finalCommitSha], body);
}

async function finalizePrDelivery(
  ctx: DeliveryContext,
  taskSnapshot: TaskPlanningSnapshot,
  worktreePath: string,
  branchName: string,
  defaultBranch: string,
  finalCommitSha: string,
  changedFiles: string[],
  approvedPlanBody: string,
): Promise<Result<RunTaskDeliveryOutput>> {
  const prRes = await createDeliveryPr(
    ctx,
    taskSnapshot,
    worktreePath,
    branchName,
    defaultBranch,
    finalCommitSha,
    changedFiles,
    approvedPlanBody,
  );
  if (!prRes.success) return prRes;
  const { prUrl, prNumber } = prRes.data;
  const body = [
    'Delivery 完成：已推送并创建 PR。',
    '',
    `- 分支：${branchName}`,
    `- Commit：${finalCommitSha}`,
    `- PR：${prUrl}`,
  ].join('\n');
  return finalizeDelivery(
    ctx,
    branchName,
    [finalCommitSha],
    body,
    prUrl,
    prNumber,
  );
}

async function setupDeliveryRun(
  input: RunTaskDeliveryInput,
  snapshot: TaskPlanningSnapshot,
): Promise<Result<{ ctx: DeliveryContext; approvedPlanBody: string }>> {
  const precondRes = await validateDeliveryPreconditions(input);
  if (!precondRes.success) return precondRes;
  const approvedPlan = snapshot.plans.find(
    (p) => p.planId === precondRes.data.approvedPlanId,
  );
  if (!approvedPlan) return failure('当前 Task 缺少已批准方案，不能交付');
  const runRes = createTaskAgentRun({
    taskId: input.taskId,
    threadId: snapshot.thread.threadId,
    agentId: 'delivery',
    runtimeId: 'system',
    inputArtifactIds: [
      approvedPlan.artifactId,
      ...snapshot.artifacts.map((a) => a.artifactId),
    ],
  });
  if (!runRes.success) return runRes;
  return success({
    ctx: { input, snapshot, run: runRes.data },
    approvedPlanBody: approvedPlan.body,
  });
}

async function collectAndPush(
  ctx: DeliveryContext,
  worktreePath: string,
  branchName: string,
  defaultBranch: string,
): Promise<Result<{ finalCommitSha: string; changedFiles: string[] }>> {
  const commitsRes = await collectDeliveryCommits(
    ctx,
    worktreePath,
    branchName,
    defaultBranch,
  );
  if (!commitsRes.success) return commitsRes;
  return pushDeliveryBranch(ctx, worktreePath, branchName, defaultBranch);
}

async function executeDelivery(
  ctx: DeliveryContext,
  approvedPlanBody: string,
  snapshot: TaskPlanningSnapshot,
): Promise<Result<RunTaskDeliveryOutput>> {
  const worktreeRes = await prepareDeliveryWorktree(ctx);
  if (!worktreeRes.success) return worktreeRes;
  const {
    worktreePath,
    branchName,
    defaultBranch,
    snapshot: taskSnapshot,
  } = worktreeRes.data;
  const taskCtx: DeliveryContext = { ...ctx, snapshot: taskSnapshot };

  const pushRes = await collectAndPush(
    taskCtx,
    worktreePath,
    branchName,
    defaultBranch,
  );
  if (!pushRes.success) return pushRes;
  const { finalCommitSha, changedFiles } = pushRes.data;

  if (snapshot.task.workspaceMode === TASK_WORKSPACE_MODE.DEFAULT_BRANCH) {
    return finalizeDefaultBranchDelivery(ctx, branchName, finalCommitSha);
  }
  return finalizePrDelivery(
    taskCtx,
    taskSnapshot,
    worktreePath,
    branchName,
    defaultBranch,
    finalCommitSha,
    changedFiles,
    approvedPlanBody,
  );
}

export async function runTaskDelivery(
  input: RunTaskDeliveryInput,
): Promise<Result<RunTaskDeliveryOutput>> {
  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${input.taskId}`);
  const alreadyDone = checkAlreadyDelivered(snapshot);
  if (alreadyDone) return success(alreadyDone);

  const setupRes = await setupDeliveryRun(input, snapshot);
  if (!setupRes.success) return setupRes;
  return executeDelivery(
    setupRes.data.ctx,
    setupRes.data.approvedPlanBody,
    snapshot,
  );
}
