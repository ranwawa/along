import type { Result } from '../core/result';
import { success } from '../core/result';
import { settlePostCommitChanges } from './task-auto-commit-settle';
import type {
  RunTaskAutoCommitInput,
  TaskAutoCommitFailure,
  TaskAutoCommitResult,
} from './task-auto-commit-types';
import {
  artifactLog,
  buildCommitMessage,
  parseChangedFiles,
  summarizeFailure,
} from './task-auto-commit-utils';
import {
  recordTaskAgentResult,
  transitionTaskWorkflow,
  updateTaskDelivery,
} from './task-planning';
import type { TaskWorktreeCommandRunner } from './task-worktree';

async function runGit(
  runner: TaskWorktreeCommandRunner,
  cwd: string,
  args: string[],
): Promise<Result<string>> {
  return runner('git', args, { cwd });
}

async function readExistingCommit(input: RunTaskAutoCommitInput) {
  if (input.snapshot.task.commitShas.length > 0) {
    return success(input.snapshot.task.commitShas);
  }

  const revListRes = await runGit(input.commandRunner, input.worktreePath, [
    'rev-list',
    '--max-count=1',
    `origin/${input.defaultBranch}..HEAD`,
  ]);
  if (!revListRes.success) return revListRes;
  const sha = revListRes.data.trim();
  return success(sha ? [sha] : []);
}

function recordAutoCommitResult(
  input: RunTaskAutoCommitInput,
  body: string,
): string | undefined {
  const artifactRes = recordTaskAgentResult({
    taskId: input.snapshot.task.taskId,
    threadId: input.snapshot.thread.threadId,
    agentId: 'auto-commit',
    runtimeId: 'system',
    body,
  });
  return artifactRes.success ? artifactRes.data.artifactId : undefined;
}

function failAutoCommit(input: {
  step: string;
  command: string;
  error: string;
  changedFiles: string[];
  autoCommitInput: RunTaskAutoCommitInput;
}): TaskAutoCommitFailure {
  const summary = summarizeFailure(input.error);
  const failureArtifactId = recordAutoCommitResult(
    input.autoCommitInput,
    [
      `Auto-commit 失败：${input.step}`,
      '',
      `命令：${input.command}`,
      '',
      '错误摘要：',
      summary,
      '',
      '完整输出：',
      artifactLog(input.error),
    ].join('\n'),
  );
  return {
    success: false,
    error: `${input.step}: ${summary}`,
    command: input.command,
    summary,
    changedFiles: input.changedFiles,
    failureArtifactId,
  };
}

function updateCommitMetadata(
  input: RunTaskAutoCommitInput,
  commitShas: string[],
) {
  const deliveryRes = updateTaskDelivery({
    taskId: input.snapshot.task.taskId,
    worktreePath: input.worktreePath,
    branchName: input.branchName,
    commitShas,
  });
  if (!deliveryRes.success) return deliveryRes;
  return transitionTaskWorkflow({
    taskId: input.snapshot.task.taskId,
    event: { type: 'exec.completed' },
  });
}

async function readChangedFiles(
  input: RunTaskAutoCommitInput,
): Promise<TaskAutoCommitFailure | string[]> {
  const statusRes = await runGit(input.commandRunner, input.worktreePath, [
    'status',
    '--porcelain',
  ]);
  if (!statusRes.success) {
    return failAutoCommit({
      step: '读取 git 状态失败',
      command: 'git status --porcelain',
      error: statusRes.error,
      changedFiles: [],
      autoCommitInput: input,
    });
  }

  return parseChangedFiles(statusRes.data);
}

function successResult(input: {
  commitShas: string[];
  changedFiles: string[];
  commitMessage: string;
  alreadyCommitted: boolean;
}): TaskAutoCommitResult {
  return { success: true, data: input };
}

async function reuseExistingCommit(
  input: RunTaskAutoCommitInput,
  changedFiles: string[],
  commitMessage: string,
): Promise<TaskAutoCommitResult> {
  const existingCommitRes = await readExistingCommit(input);
  if (!existingCommitRes.success) {
    return failAutoCommit({
      step: '读取已有 commit 失败',
      command: `git rev-list --max-count=1 origin/${input.defaultBranch}..HEAD`,
      error: existingCommitRes.error,
      changedFiles,
      autoCommitInput: input,
    });
  }
  if (existingCommitRes.data.length === 0) {
    return failAutoCommit({
      step: '没有可提交变更',
      command: 'git status --porcelain',
      error: 'Exec agent 完成后未检测到工作区变更或本地 commit。',
      changedFiles,
      autoCommitInput: input,
    });
  }

  const updateRes = updateCommitMetadata(input, existingCommitRes.data);
  if (!updateRes.success) {
    return failAutoCommit({
      step: '记录已有 commit 失败',
      command: 'update task commit metadata',
      error: updateRes.error,
      changedFiles,
      autoCommitInput: input,
    });
  }

  return successResult({
    commitShas: existingCommitRes.data,
    changedFiles,
    commitMessage,
    alreadyCommitted: true,
  });
}

async function stageAndCommitChanges(
  input: RunTaskAutoCommitInput,
  changedFiles: string[],
  commitMessage: string,
): Promise<TaskAutoCommitFailure | string[]> {
  const addRes = await runGit(input.commandRunner, input.worktreePath, [
    'add',
    '-A',
  ]);
  if (!addRes.success) {
    return failAutoCommit({
      step: '暂存变更失败',
      command: 'git add -A',
      error: addRes.error,
      changedFiles,
      autoCommitInput: input,
    });
  }

  const commitRes = await runGit(input.commandRunner, input.worktreePath, [
    'commit',
    '-m',
    commitMessage,
  ]);
  if (!commitRes.success) {
    return failAutoCommit({
      step: '提交失败',
      command: `git commit -m "${commitMessage}"`,
      error: commitRes.error,
      changedFiles,
      autoCommitInput: input,
    });
  }

  return settlePostCommitChanges({
    changedFiles,
    runGit: (args) => runGit(input.commandRunner, input.worktreePath, args),
    fail: (failureInput) =>
      failAutoCommit({
        ...failureInput,
        autoCommitInput: input,
      }),
  });
}

async function readNewCommitSha(
  input: RunTaskAutoCommitInput,
  changedFiles: string[],
): Promise<TaskAutoCommitFailure | string[]> {
  const shaRes = await runGit(input.commandRunner, input.worktreePath, [
    'rev-parse',
    'HEAD',
  ]);
  if (!shaRes.success) {
    return failAutoCommit({
      step: '读取 commit sha 失败',
      command: 'git rev-parse HEAD',
      error: shaRes.error,
      changedFiles,
      autoCommitInput: input,
    });
  }
  return [shaRes.data.trim()].filter(Boolean);
}

async function recordNewCommit(
  input: RunTaskAutoCommitInput,
  changedFiles: string[],
  commitMessage: string,
): Promise<TaskAutoCommitResult> {
  const commitShas = await readNewCommitSha(input, changedFiles);
  if ('success' in commitShas) return commitShas;

  const updateRes = updateCommitMetadata(input, commitShas);
  if (!updateRes.success) {
    return failAutoCommit({
      step: '记录 commit 信息失败',
      command: 'update task commit metadata',
      error: updateRes.error,
      changedFiles,
      autoCommitInput: input,
    });
  }
  recordAutoCommitResult(
    input,
    [
      'Auto-commit 完成：已在实施阶段提交本地变更。',
      '',
      `- Commit：${commitShas.join(', ')}`,
      `- Message：${commitMessage}`,
      `- Files：${changedFiles.join(', ')}`,
    ].join('\n'),
  );
  return successResult({
    commitShas,
    changedFiles,
    commitMessage,
    alreadyCommitted: false,
  });
}

export async function runTaskAutoCommit(
  input: RunTaskAutoCommitInput,
): Promise<TaskAutoCommitResult> {
  const changedFiles = await readChangedFiles(input);
  if ('success' in changedFiles) return changedFiles;

  const commitMessage = buildCommitMessage(input.snapshot);
  if (changedFiles.length === 0) {
    return reuseExistingCommit(input, changedFiles, commitMessage);
  }

  const committedFiles = await stageAndCommitChanges(
    input,
    changedFiles,
    commitMessage,
  );
  if ('success' in committedFiles) return committedFiles;
  return recordNewCommit(input, committedFiles, commitMessage);
}
