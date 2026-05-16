import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  AGENT_RUN_STATUS,
  finishTaskAgentRun,
  LIFECYCLE,
  readTaskPlanningSnapshot,
  recordTaskAgentResult,
  type TaskAgentRunRecord,
  type TaskPlanningSnapshot,
  transitionTaskWorkflow,
  updateTaskDelivery,
  WORKFLOW_KIND,
} from './task-planning';
import {
  defaultTaskWorktreeCommandRunner,
  ensureTaskRepository,
  prepareTaskWorktree,
  type TaskWorktreeCommandOptions,
  type TaskWorktreeCommandRunner,
} from './task-worktree';

export type TaskDeliveryCommandOptions = TaskWorktreeCommandOptions;
export type TaskDeliveryCommandRunner = TaskWorktreeCommandRunner;
export { defaultTaskWorktreeCommandRunner };

export interface RunTaskDeliveryInput {
  taskId: string;
  cwd: string;
  commandRunner?: TaskDeliveryCommandRunner;
  readToken?: () => Promise<Result<string>>;
  readDefaultBranch?: (cwd: string) => Promise<Result<string>>;
}

export interface RunTaskDeliveryOutput {
  snapshot: TaskPlanningSnapshot;
  branchName: string;
  commitShas: string[];
  prUrl?: string;
  prNumber?: number;
}

export interface DeliveryContext {
  input: RunTaskDeliveryInput;
  snapshot: TaskPlanningSnapshot;
  run: TaskAgentRunRecord;
}

const GIT_STATUS_FILE_PREFIX_LEN = 3;

export function parseChangedFiles(status: string): string[] {
  const files = status
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const file = line.slice(GIT_STATUS_FILE_PREFIX_LEN).trim();
      const renameTarget = file.split(' -> ').pop();
      return renameTarget || file;
    })
    .filter(Boolean);
  return [...new Set(files)].sort();
}

export async function runGit(
  runner: TaskDeliveryCommandRunner,
  cwd: string,
  args: string[],
): Promise<Result<string>> {
  return runner('git', args, { cwd });
}

export function failDeliveryRun(
  ctx: DeliveryContext,
  message: string,
): Result<never> {
  const { input, snapshot, run } = ctx;
  transitionTaskWorkflow({
    taskId: input.taskId,
    event: { type: 'task.failed' },
  });
  recordTaskAgentResult({
    taskId: input.taskId,
    threadId: snapshot.thread.threadId,
    agentId: 'delivery',
    runtimeId: 'system',
    body: `Delivery 失败：${message}`,
  });
  const runRes = finishTaskAgentRun({
    runId: run.runId,
    status: AGENT_RUN_STATUS.FAILED,
    error: message,
  });
  return runRes.success ? failure(message) : failure(runRes.error);
}

export async function validateDeliveryPreconditions(
  input: RunTaskDeliveryInput,
): Promise<Result<{ snapshot: TaskPlanningSnapshot; approvedPlanId: string }>> {
  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${input.taskId}`);
  if (snapshot.task.lifecycle === LIFECYCLE.DONE)
    return failure('Task 已关闭，不能交付');
  if (
    snapshot.task.currentWorkflowKind !== WORKFLOW_KIND.EXEC ||
    snapshot.task.lifecycle !== LIFECYCLE.WAITING ||
    snapshot.task.prUrl
  ) {
    return failure(
      `当前 Task 工作流不能交付: ${snapshot.task.currentWorkflowKind}/${snapshot.task.lifecycle}`,
    );
  }
  if (!snapshot.thread.approvedPlanId)
    return failure('当前 Task 缺少已批准方案，不能交付');
  return success({ snapshot, approvedPlanId: snapshot.thread.approvedPlanId });
}

export async function prepareDeliveryWorktree(ctx: DeliveryContext): Promise<
  Result<{
    worktreePath: string;
    branchName: string;
    defaultBranch: string;
    snapshot: TaskPlanningSnapshot;
  }>
> {
  const { input, snapshot, run } = ctx;
  const runner = input.commandRunner || defaultTaskWorktreeCommandRunner;
  const repositoryRes = await ensureTaskRepository(snapshot, input.cwd, runner);
  if (!repositoryRes.success)
    return failure(`${repositoryRes.error}，不能创建 PR`);
  const { repoOwner, repoName } = repositoryRes.data;
  const taskSnapshot = {
    ...snapshot,
    task: { ...snapshot.task, repoOwner, repoName },
  };
  const worktreeRes = await prepareTaskWorktree({
    snapshot: taskSnapshot,
    repoPath: input.cwd,
    commandRunner: runner,
    readDefaultBranch: input.readDefaultBranch,
  });
  if (!worktreeRes.success) return failDeliveryRun(ctx, worktreeRes.error);
  const { worktreePath, branchName, defaultBranch } = worktreeRes.data;
  const startedRes = updateTaskDelivery({
    taskId: input.taskId,
    worktreePath,
    branchName,
  });
  if (!startedRes.success)
    return failDeliveryRun({ ...ctx, run }, startedRes.error);
  return success({
    worktreePath,
    branchName,
    defaultBranch,
    snapshot: taskSnapshot,
  });
}

async function resolveInitialCommits(
  ctx: DeliveryContext,
  worktreePath: string,
  branchName: string,
  defaultBranch: string,
): Promise<Result<string[]>> {
  const runner = ctx.input.commandRunner || defaultTaskWorktreeCommandRunner;
  const existingCommitRes = await runGit(runner, worktreePath, [
    'rev-list',
    '--max-count=1',
    `origin/${defaultBranch}..HEAD`,
  ]);
  if (!existingCommitRes.success)
    return failDeliveryRun(
      ctx,
      `读取已有 commit 失败: ${existingCommitRes.error}`,
    );
  const existingCommit = existingCommitRes.data.trim();
  if (!existingCommit)
    return failDeliveryRun(ctx, '没有已提交 commit，不能交付');
  const commitShas = [existingCommit];
  const commitMetaRes = updateTaskDelivery({
    taskId: ctx.input.taskId,
    branchName,
    commitShas,
  });
  if (!commitMetaRes.success) return failDeliveryRun(ctx, commitMetaRes.error);
  return success(commitShas);
}

export async function collectDeliveryCommits(
  ctx: DeliveryContext,
  worktreePath: string,
  branchName: string,
  defaultBranch: string,
): Promise<Result<string[]>> {
  const runner = ctx.input.commandRunner || defaultTaskWorktreeCommandRunner;
  const statusRes = await runGit(runner, worktreePath, [
    'status',
    '--porcelain',
  ]);
  if (!statusRes.success)
    return failDeliveryRun(ctx, `读取 git 状态失败: ${statusRes.error}`);
  const uncommittedFiles = parseChangedFiles(statusRes.data);
  if (uncommittedFiles.length > 0)
    return failDeliveryRun(
      ctx,
      `存在未提交变更，不能交付。请先完成实施阶段 auto-commit: ${uncommittedFiles.join(', ')}`,
    );
  if (ctx.snapshot.task.commitShas.length > 0)
    return success(ctx.snapshot.task.commitShas);
  return resolveInitialCommits(ctx, worktreePath, branchName, defaultBranch);
}

async function rebaseAndGetSha(
  ctx: DeliveryContext,
  runner: TaskDeliveryCommandRunner,
  worktreePath: string,
  branchName: string,
  defaultBranch: string,
): Promise<Result<string>> {
  const rebaseRes = await runGit(runner, worktreePath, [
    'rebase',
    `origin/${defaultBranch}`,
  ]);
  if (!rebaseRes.success)
    return failDeliveryRun(
      ctx,
      `rebase 失败，请手动处理冲突: ${rebaseRes.error}`,
    );
  const finalShaRes = await runGit(runner, worktreePath, ['rev-parse', 'HEAD']);
  if (!finalShaRes.success)
    return failDeliveryRun(
      ctx,
      `读取 rebase 后 commit sha 失败: ${finalShaRes.error}`,
    );
  const pushRes = await runGit(runner, worktreePath, [
    'push',
    '--set-upstream',
    'origin',
    branchName,
  ]);
  if (!pushRes.success)
    return failDeliveryRun(ctx, `推送分支失败: ${pushRes.error}`);
  return success(finalShaRes.data.trim());
}

export async function pushDeliveryBranch(
  ctx: DeliveryContext,
  worktreePath: string,
  branchName: string,
  defaultBranch: string,
): Promise<Result<{ finalCommitSha: string; changedFiles: string[] }>> {
  const runner = ctx.input.commandRunner || defaultTaskWorktreeCommandRunner;
  const changedFileRes = await runGit(runner, worktreePath, [
    'diff',
    '--name-only',
    `origin/${defaultBranch}...HEAD`,
  ]);
  if (!changedFileRes.success)
    return failDeliveryRun(
      ctx,
      `读取 PR 文件列表失败: ${changedFileRes.error}`,
    );
  const changedFiles = changedFileRes.data
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)
    .sort();
  const finalShaRes = await rebaseAndGetSha(
    ctx,
    runner,
    worktreePath,
    branchName,
    defaultBranch,
  );
  if (!finalShaRes.success) return finalShaRes;
  return success({ finalCommitSha: finalShaRes.data, changedFiles });
}
