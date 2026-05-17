import type { Result } from '../../core/result';
import type { TaskAutoCommitFailure } from './auto-commit-types';
import { parseChangedFiles } from './auto-commit-utils';

interface FailAutoCommitInput {
  step: string;
  command: string;
  error: string;
  changedFiles: string[];
}

interface SettlePostCommitChangesInput {
  changedFiles: string[];
  runGit: (args: string[]) => Promise<Result<string>>;
  fail: (input: FailAutoCommitInput) => TaskAutoCommitFailure;
}

function mergeChangedFiles(...groups: string[][]): string[] {
  return [...new Set(groups.flat())].sort();
}

async function readChangedFiles(
  input: SettlePostCommitChangesInput,
): Promise<TaskAutoCommitFailure | string[]> {
  const statusRes = await input.runGit(['status', '--porcelain']);
  if (!statusRes.success) {
    return input.fail({
      step: '读取提交后 git 状态失败',
      command: 'git status --porcelain',
      error: statusRes.error,
      changedFiles: input.changedFiles,
    });
  }
  return parseChangedFiles(statusRes.data);
}

function failDirtyAfterAmend(
  input: SettlePostCommitChangesInput,
  allChangedFiles: string[],
  finalFiles: string[],
) {
  return input.fail({
    step: '提交后仍有未提交变更',
    command: 'git status --porcelain',
    error: `commit hook 或格式化工具在 amend 后仍留下未提交变更: ${finalFiles.join(
      ', ',
    )}`,
    changedFiles: mergeChangedFiles(allChangedFiles, finalFiles),
  });
}

export async function settlePostCommitChanges(
  input: SettlePostCommitChangesInput,
): Promise<TaskAutoCommitFailure | string[]> {
  const postCommitFiles = await readChangedFiles(input);
  if ('success' in postCommitFiles) return postCommitFiles;
  if (postCommitFiles.length === 0) return input.changedFiles;

  const allChangedFiles = mergeChangedFiles(
    input.changedFiles,
    postCommitFiles,
  );
  const addRes = await input.runGit(['add', '-A']);
  if (!addRes.success) {
    return input.fail({
      step: '暂存提交后变更失败',
      command: 'git add -A',
      error: addRes.error,
      changedFiles: allChangedFiles,
    });
  }

  const amendRes = await input.runGit(['commit', '--amend', '--no-edit']);
  if (!amendRes.success) {
    return input.fail({
      step: '补提交提交后变更失败',
      command: 'git commit --amend --no-edit',
      error: amendRes.error,
      changedFiles: allChangedFiles,
    });
  }

  const finalFiles = await readChangedFiles({
    ...input,
    changedFiles: allChangedFiles,
  });
  if ('success' in finalFiles) return finalFiles;
  return finalFiles.length === 0
    ? allChangedFiles
    : failDirtyAfterAmend(input, allChangedFiles, finalFiles);
}
