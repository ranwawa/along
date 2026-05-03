import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import { readGithubToken } from '../integration/github-client';
import {
  readTaskPlanningSnapshot,
  recordTaskAgentResult,
  TASK_STATUS,
  type TaskPlanningSnapshot,
  updateTaskDelivery,
} from './task-planning';
import {
  defaultTaskWorktreeCommandRunner,
  prepareTaskWorktree,
  type TaskWorktreeCommandOptions,
  type TaskWorktreeCommandRunner,
} from './task-worktree';

export type TaskDeliveryCommandOptions = TaskWorktreeCommandOptions;
export type TaskDeliveryCommandRunner = TaskWorktreeCommandRunner;

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
  prUrl: string;
  prNumber?: number;
}

function normalizeTitle(title: string, maxLength = 60): string {
  const text = title.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function parseChangedFiles(status: string): string[] {
  const files = status
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const file = line.slice(3).trim();
      const renameTarget = file.split(' -> ').pop();
      return renameTarget || file;
    })
    .filter(Boolean);
  return [...new Set(files)].sort();
}

function parsePrNumber(prUrl: string): number | undefined {
  const match = prUrl.match(/\/pull\/(\d+)/);
  return match ? Number(match[1]) : undefined;
}

async function runGit(
  runner: TaskDeliveryCommandRunner,
  cwd: string,
  args: string[],
): Promise<Result<string>> {
  return runner('git', args, { cwd });
}

function buildPrBody(input: {
  taskId: string;
  planBody: string;
  changedFiles: string[];
  branchName: string;
  commitSha: string;
}): string {
  const changedFileLines = input.changedFiles
    .map((file) => `- \`${file}\``)
    .join('\n');

  return [
    `along-task: ${input.taskId}`,
    '',
    '## 修改内容',
    changedFileLines || '- 已按批准方案完成代码实现',
    '',
    '## 执行步骤',
    '1. 读取 Task 已批准方案',
    '2. 在本地仓库完成代码实现',
    `3. 提交并推送分支 \`${input.branchName}\``,
    '4. 创建 Pull Request',
    '',
    '## 影响范围',
    '- 影响范围以已批准方案为准',
    '- 未写入 `fixes/closes/resolves #...`，不会触发 GitHub Issue session 清理',
    '',
    '## 已批准方案',
    input.planBody.trim(),
    '',
    '## 交付信息',
    `- Commit: ${input.commitSha}`,
  ].join('\n');
}

function writeTempBodyFile(body: string): string {
  const filePath = path.join(
    os.tmpdir(),
    `along-task-pr-${Date.now()}-${Math.random().toString(16).slice(2)}.md`,
  );
  fs.writeFileSync(filePath, body, 'utf-8');
  return filePath;
}

async function failDelivery(
  taskId: string,
  threadId: string,
  message: string,
): Promise<Result<never>> {
  updateTaskDelivery({ taskId, status: TASK_STATUS.IMPLEMENTED });
  recordTaskAgentResult({
    taskId,
    threadId,
    agentId: 'delivery',
    provider: 'system',
    body: `Delivery 失败：${message}`,
  });
  return failure(message);
}

export async function runTaskDelivery(
  input: RunTaskDeliveryInput,
): Promise<Result<RunTaskDeliveryOutput>> {
  const runner = input.commandRunner || defaultTaskWorktreeCommandRunner;
  const readToken = input.readToken || readGithubToken;

  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${input.taskId}`);

  if (snapshot.task.prUrl) {
    return success({
      snapshot,
      branchName: snapshot.task.branchName || '',
      commitShas: snapshot.task.commitShas,
      prUrl: snapshot.task.prUrl,
      prNumber: snapshot.task.prNumber,
    });
  }

  if (snapshot.task.status !== TASK_STATUS.IMPLEMENTED) {
    return failure(`当前 Task 状态不能交付: ${snapshot.task.status}`);
  }

  if (!snapshot.task.repoOwner || !snapshot.task.repoName) {
    return failure('当前 Task 缺少仓库 owner/repo，不能创建 PR');
  }

  const approvedPlan = snapshot.plans.find(
    (plan) => plan.planId === snapshot.thread.approvedPlanId,
  );
  if (!approvedPlan) return failure('当前 Task 缺少已批准方案，不能交付');

  const worktreeRes = await prepareTaskWorktree({
    snapshot,
    repoPath: input.cwd,
    commandRunner: runner,
    readDefaultBranch: input.readDefaultBranch,
  });
  if (!worktreeRes.success) return worktreeRes;
  const { worktreePath, branchName, defaultBranch } = worktreeRes.data;

  const startedRes = updateTaskDelivery({
    taskId: input.taskId,
    status: TASK_STATUS.DELIVERING,
    worktreePath,
    branchName,
  });
  if (!startedRes.success) return startedRes;

  const statusRes = await runGit(runner, worktreePath, [
    'status',
    '--porcelain',
  ]);
  if (!statusRes.success) {
    return failDelivery(
      input.taskId,
      snapshot.thread.threadId,
      `读取 git 状态失败: ${statusRes.error}`,
    );
  }

  const changedFiles = parseChangedFiles(statusRes.data);
  if (changedFiles.length === 0 && snapshot.task.commitShas.length === 0) {
    return failDelivery(
      input.taskId,
      snapshot.thread.threadId,
      '没有可提交变更',
    );
  }

  let commitShas = snapshot.task.commitShas;
  if (changedFiles.length > 0) {
    const branchRes = updateTaskDelivery({
      taskId: input.taskId,
      status: TASK_STATUS.DELIVERING,
      branchName,
    });
    if (!branchRes.success) return branchRes;

    const addRes = await runGit(runner, worktreePath, ['add', '-A']);
    if (!addRes.success) {
      return failDelivery(
        input.taskId,
        snapshot.thread.threadId,
        `暂存变更失败: ${addRes.error}`,
      );
    }

    const commitMessage = `feat(task): 完成${normalizeTitle(
      snapshot.task.title,
      42,
    )}，交付已批准方案`;
    const commitRes = await runGit(runner, worktreePath, [
      'commit',
      '-m',
      commitMessage,
    ]);
    if (!commitRes.success) {
      return failDelivery(
        input.taskId,
        snapshot.thread.threadId,
        `提交失败: ${commitRes.error}`,
      );
    }

    const committedShaRes = await runGit(runner, worktreePath, [
      'rev-parse',
      'HEAD',
    ]);
    if (!committedShaRes.success) {
      return failDelivery(
        input.taskId,
        snapshot.thread.threadId,
        `读取 commit sha 失败: ${committedShaRes.error}`,
      );
    }
    commitShas = [committedShaRes.data.trim()];
    const commitMetaRes = updateTaskDelivery({
      taskId: input.taskId,
      status: TASK_STATUS.DELIVERING,
      branchName,
      commitShas,
    });
    if (!commitMetaRes.success) return commitMetaRes;
  }

  const rebaseRes = await runGit(runner, worktreePath, [
    'rebase',
    `origin/${defaultBranch}`,
  ]);
  if (!rebaseRes.success) {
    return failDelivery(
      input.taskId,
      snapshot.thread.threadId,
      `rebase 失败，请手动处理冲突: ${rebaseRes.error}`,
    );
  }

  const finalShaRes = await runGit(runner, worktreePath, ['rev-parse', 'HEAD']);
  if (!finalShaRes.success) {
    return failDelivery(
      input.taskId,
      snapshot.thread.threadId,
      `读取 rebase 后 commit sha 失败: ${finalShaRes.error}`,
    );
  }
  const finalCommitSha = finalShaRes.data.trim();
  commitShas = [finalCommitSha];

  const pushRes = await runGit(runner, worktreePath, [
    'push',
    '--set-upstream',
    'origin',
    branchName,
  ]);
  if (!pushRes.success) {
    return failDelivery(
      input.taskId,
      snapshot.thread.threadId,
      `推送分支失败: ${pushRes.error}`,
    );
  }

  const tokenRes = await readToken();
  if (!tokenRes.success) {
    return failDelivery(input.taskId, snapshot.thread.threadId, tokenRes.error);
  }

  const body = buildPrBody({
    taskId: input.taskId,
    planBody: approvedPlan.body,
    changedFiles,
    branchName,
    commitSha: finalCommitSha,
  });
  const bodyFile = writeTempBodyFile(body);
  try {
    const ghRes = await runner(
      'gh',
      [
        'pr',
        'create',
        '--repo',
        `${snapshot.task.repoOwner}/${snapshot.task.repoName}`,
        '--head',
        branchName,
        '--base',
        defaultBranch,
        '--title',
        `Task: ${normalizeTitle(snapshot.task.title, 90)}`,
        '--body-file',
        bodyFile,
      ],
      {
        cwd: worktreePath,
        env: { ...process.env, GH_TOKEN: tokenRes.data },
      },
    );
    if (!ghRes.success) {
      return failDelivery(
        input.taskId,
        snapshot.thread.threadId,
        `创建 PR 失败: ${ghRes.error}`,
      );
    }

    const prUrl = ghRes.data.trim();
    const prNumber = parsePrNumber(prUrl);
    const deliveryRes = updateTaskDelivery({
      taskId: input.taskId,
      status: TASK_STATUS.DELIVERED,
      branchName,
      commitShas,
      prUrl,
      prNumber,
    });
    if (!deliveryRes.success) return deliveryRes;

    recordTaskAgentResult({
      taskId: input.taskId,
      threadId: snapshot.thread.threadId,
      agentId: 'delivery',
      provider: 'system',
      body: [
        'Delivery 完成：已提交、推送并创建 PR。',
        '',
        `- 分支：${branchName}`,
        `- Commit：${finalCommitSha}`,
        `- PR：${prUrl}`,
      ].join('\n'),
    });

    const refreshedSnapshotRes = readTaskPlanningSnapshot(input.taskId);
    if (!refreshedSnapshotRes.success) return refreshedSnapshotRes;
    if (!refreshedSnapshotRes.data) {
      return failure(`Task ${input.taskId} 已交付，但读取快照失败`);
    }

    return success({
      snapshot: refreshedSnapshotRes.data,
      branchName,
      commitShas,
      prUrl,
      prNumber,
    });
  } finally {
    try {
      fs.unlinkSync(bodyFile);
    } catch {}
  }
}
