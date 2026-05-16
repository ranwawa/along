// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: legacy delivery orchestration predates current function-size rule.
// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: legacy delivery module predates current file-size rule.
// biome-ignore-all lint/style/noMagicNumbers: legacy delivery orchestration predates current magic-number rule.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readGhToken } from '../core/git-token';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  AGENT_RUN_STATUS,
  createTaskAgentRun,
  finishTaskAgentRun,
  LIFECYCLE,
  readTaskPlanningSnapshot,
  recordTaskAgentResult,
  TASK_WORKSPACE_MODE,
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
  seq?: number;
  planBody: string;
  changedFiles: string[];
  branchName: string;
  commitSha: string;
}): string {
  const changedFileLines = input.changedFiles
    .map((file) => `- \`${file}\``)
    .join('\n');

  return [
    input.seq != null
      ? `along-task: #${input.seq}`
      : `along-task: ${input.taskId}`,
    '',
    '## 修改内容',
    changedFileLines || '- 已按批准方案完成代码实现',
    '',
    '## 执行步骤',
    '1. 读取 Task 已批准方案',
    '2. 确认实施阶段已完成本地 commit',
    `3. 推送分支 \`${input.branchName}\``,
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

function failDeliveryRun(
  run: TaskAgentRunRecord,
  taskId: string,
  threadId: string,
  message: string,
): Result<never> {
  transitionTaskWorkflow({
    taskId,
    event: { type: 'task.failed' },
  });
  recordTaskAgentResult({
    taskId,
    threadId,
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

export async function runTaskDelivery(
  input: RunTaskDeliveryInput,
): Promise<Result<RunTaskDeliveryOutput>> {
  const runner = input.commandRunner || defaultTaskWorktreeCommandRunner;
  const readToken = input.readToken || readGhToken;

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
  if (
    snapshot.task.workspaceMode === TASK_WORKSPACE_MODE.DEFAULT_BRANCH &&
    snapshot.task.status === 'delivered'
  ) {
    return success({
      snapshot,
      branchName: snapshot.task.branchName || '',
      commitShas: snapshot.task.commitShas,
      prUrl: snapshot.task.prUrl,
      prNumber: snapshot.task.prNumber,
    });
  }

  if (snapshot.task.lifecycle === LIFECYCLE.DONE) {
    return failure('Task 已关闭，不能交付');
  }
  if (
    snapshot.task.currentWorkflowKind !== WORKFLOW_KIND.EXEC ||
    snapshot.task.lifecycle !== LIFECYCLE.WAITING ||
    snapshot.task.prUrl
  ) {
    return failure(
      `当前 Task 工作流不能交付: ${snapshot.task.currentWorkflowKind}/${snapshot.task.lifecycle}`,
    );
  }

  const repositoryRes = await ensureTaskRepository(snapshot, input.cwd, runner);
  if (!repositoryRes.success) {
    return failure(`${repositoryRes.error}，不能创建 PR`);
  }
  const { repoOwner, repoName } = repositoryRes.data;
  const taskSnapshot = {
    ...snapshot,
    task: {
      ...snapshot.task,
      repoOwner,
      repoName,
    },
  };

  const approvedPlan = snapshot.plans.find(
    (plan) => plan.planId === snapshot.thread.approvedPlanId,
  );
  if (!approvedPlan) return failure('当前 Task 缺少已批准方案，不能交付');

  const runRes = createTaskAgentRun({
    taskId: input.taskId,
    threadId: snapshot.thread.threadId,
    agentId: 'delivery',
    runtimeId: 'system',
    inputArtifactIds: [
      approvedPlan.artifactId,
      ...snapshot.artifacts.map((artifact) => artifact.artifactId),
    ],
  });
  if (!runRes.success) return runRes;
  const run = runRes.data;

  const worktreeRes = await prepareTaskWorktree({
    snapshot: taskSnapshot,
    repoPath: input.cwd,
    commandRunner: runner,
    readDefaultBranch: input.readDefaultBranch,
  });
  if (!worktreeRes.success) {
    return failDeliveryRun(
      run,
      input.taskId,
      snapshot.thread.threadId,
      worktreeRes.error,
    );
  }
  const { worktreePath, branchName, defaultBranch } = worktreeRes.data;

  const startedRes = updateTaskDelivery({
    taskId: input.taskId,
    worktreePath,
    branchName,
  });
  if (!startedRes.success) {
    return failDeliveryRun(
      run,
      input.taskId,
      snapshot.thread.threadId,
      startedRes.error,
    );
  }

  const statusRes = await runGit(runner, worktreePath, [
    'status',
    '--porcelain',
  ]);
  if (!statusRes.success) {
    return failDeliveryRun(
      run,
      input.taskId,
      snapshot.thread.threadId,
      `读取 git 状态失败: ${statusRes.error}`,
    );
  }

  const uncommittedFiles = parseChangedFiles(statusRes.data);
  if (uncommittedFiles.length > 0) {
    return failDeliveryRun(
      run,
      input.taskId,
      snapshot.thread.threadId,
      `存在未提交变更，不能交付。请先完成实施阶段 auto-commit: ${uncommittedFiles.join(
        ', ',
      )}`,
    );
  }

  let commitShas = snapshot.task.commitShas;
  if (commitShas.length === 0) {
    const existingCommitRes = await runGit(runner, worktreePath, [
      'rev-list',
      '--max-count=1',
      `origin/${defaultBranch}..HEAD`,
    ]);
    if (!existingCommitRes.success) {
      return failDeliveryRun(
        run,
        input.taskId,
        snapshot.thread.threadId,
        `读取已有 commit 失败: ${existingCommitRes.error}`,
      );
    }
    const existingCommit = existingCommitRes.data.trim();
    if (!existingCommit) {
      return failDeliveryRun(
        run,
        input.taskId,
        snapshot.thread.threadId,
        '没有已提交 commit，不能交付',
      );
    }
    commitShas = [existingCommit];
    const commitMetaRes = updateTaskDelivery({
      taskId: input.taskId,
      branchName,
      commitShas,
    });
    if (!commitMetaRes.success) {
      return failDeliveryRun(
        run,
        input.taskId,
        snapshot.thread.threadId,
        commitMetaRes.error,
      );
    }
  }

  const changedFileRes = await runGit(runner, worktreePath, [
    'diff',
    '--name-only',
    `origin/${defaultBranch}...HEAD`,
  ]);
  if (!changedFileRes.success) {
    return failDeliveryRun(
      run,
      input.taskId,
      snapshot.thread.threadId,
      `读取 PR 文件列表失败: ${changedFileRes.error}`,
    );
  }
  const changedFiles = changedFileRes.data
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean)
    .sort();

  const rebaseRes = await runGit(runner, worktreePath, [
    'rebase',
    `origin/${defaultBranch}`,
  ]);
  if (!rebaseRes.success) {
    return failDeliveryRun(
      run,
      input.taskId,
      snapshot.thread.threadId,
      `rebase 失败，请手动处理冲突: ${rebaseRes.error}`,
    );
  }

  const finalShaRes = await runGit(runner, worktreePath, ['rev-parse', 'HEAD']);
  if (!finalShaRes.success) {
    return failDeliveryRun(
      run,
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
    return failDeliveryRun(
      run,
      input.taskId,
      snapshot.thread.threadId,
      `推送分支失败: ${pushRes.error}`,
    );
  }

  if (snapshot.task.workspaceMode === TASK_WORKSPACE_MODE.DEFAULT_BRANCH) {
    const deliveryRes = updateTaskDelivery({
      taskId: input.taskId,
      branchName,
      commitShas,
    });
    if (!deliveryRes.success) {
      return failDeliveryRun(
        run,
        input.taskId,
        snapshot.thread.threadId,
        deliveryRes.error,
      );
    }
    const workflowDeliveredRes = transitionTaskWorkflow({
      taskId: input.taskId,
      event: { type: 'task.accepted' },
    });
    if (!workflowDeliveredRes.success) {
      return failDeliveryRun(
        run,
        input.taskId,
        snapshot.thread.threadId,
        workflowDeliveredRes.error,
      );
    }

    recordTaskAgentResult({
      taskId: input.taskId,
      threadId: snapshot.thread.threadId,
      agentId: 'delivery',
      runtimeId: 'system',
      body: [
        'Delivery 完成：已推送默认分支。',
        '',
        `- 分支：${branchName}`,
        `- Commit：${finalCommitSha}`,
      ].join('\n'),
    });

    const finishedRunRes = finishTaskAgentRun({
      runId: run.runId,
      status: AGENT_RUN_STATUS.SUCCEEDED,
    });
    if (!finishedRunRes.success) return finishedRunRes;

    const refreshedSnapshotRes = readTaskPlanningSnapshot(input.taskId);
    if (!refreshedSnapshotRes.success) return refreshedSnapshotRes;
    if (!refreshedSnapshotRes.data) {
      return failure(`Task ${input.taskId} 已交付，但读取快照失败`);
    }

    return success({
      snapshot: refreshedSnapshotRes.data,
      branchName,
      commitShas,
    });
  }

  const tokenRes = await readToken();
  if (!tokenRes.success) {
    return failDeliveryRun(
      run,
      input.taskId,
      snapshot.thread.threadId,
      tokenRes.error,
    );
  }

  const body = buildPrBody({
    taskId: input.taskId,
    seq: snapshot.task.seq,
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
        `${repoOwner}/${repoName}`,
        '--head',
        branchName,
        '--base',
        defaultBranch,
        '--title',
        snapshot.task.seq != null
          ? `Task #${snapshot.task.seq}: ${normalizeTitle(snapshot.task.title, 80)}`
          : `Task: ${normalizeTitle(snapshot.task.title, 90)}`,
        '--body-file',
        bodyFile,
      ],
      {
        cwd: worktreePath,
        env: { ...process.env, GH_TOKEN: tokenRes.data },
      },
    );
    if (!ghRes.success) {
      return failDeliveryRun(
        run,
        input.taskId,
        snapshot.thread.threadId,
        `创建 PR 失败: ${ghRes.error}`,
      );
    }

    const prUrl = ghRes.data.trim();
    const prNumber = parsePrNumber(prUrl);
    const deliveryRes = updateTaskDelivery({
      taskId: input.taskId,
      branchName,
      commitShas,
      prUrl,
      prNumber,
    });
    if (!deliveryRes.success) {
      return failDeliveryRun(
        run,
        input.taskId,
        snapshot.thread.threadId,
        deliveryRes.error,
      );
    }
    const workflowDeliveredRes = transitionTaskWorkflow({
      taskId: input.taskId,
      event: { type: 'task.accepted' },
    });
    if (!workflowDeliveredRes.success) {
      return failDeliveryRun(
        run,
        input.taskId,
        snapshot.thread.threadId,
        workflowDeliveredRes.error,
      );
    }

    recordTaskAgentResult({
      taskId: input.taskId,
      threadId: snapshot.thread.threadId,
      agentId: 'delivery',
      runtimeId: 'system',
      body: [
        'Delivery 完成：已推送并创建 PR。',
        '',
        `- 分支：${branchName}`,
        `- Commit：${finalCommitSha}`,
        `- PR：${prUrl}`,
      ].join('\n'),
    });

    const finishedRunRes = finishTaskAgentRun({
      runId: run.runId,
      status: AGENT_RUN_STATUS.SUCCEEDED,
    });
    if (!finishedRunRes.success) return finishedRunRes;

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
