import type { TaskWorktreeCommandRunner } from './task-worktree-types';

const BRANCH_SLUG_MAX_LENGTH = 36;
const BRANCH_TASK_ID_SUFFIX_LENGTH = 8;
const BRANCH_MAX_RETRY_COUNT = 20;
const BASE36_RADIX = 36;

function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/_/g, '-')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, BRANCH_SLUG_MAX_LENGTH)
    .replace(/^-|-$/g, '');
  return slug || 'task';
}

async function runGitBranch(
  runner: TaskWorktreeCommandRunner,
  cwd: string,
  args: string[],
) {
  return runner('git', args, { cwd });
}

export async function branchExists(
  runner: TaskWorktreeCommandRunner,
  repoPath: string,
  branchName: string,
): Promise<boolean> {
  const result = await runGitBranch(runner, repoPath, [
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/heads/${branchName}`,
  ]);
  return result.success;
}

export async function generateTaskBranchName(
  runner: TaskWorktreeCommandRunner,
  repoPath: string,
  taskId: string,
  title: string,
  seq?: number,
  type?: string,
): Promise<string> {
  const prefix = type || 'feat';
  const slug = slugifyTitle(title);
  const suffix =
    seq != null
      ? `-${seq}`
      : `-${taskId.replace(/^task_/, '').slice(0, BRANCH_TASK_ID_SUFFIX_LENGTH)}`;
  const base = `${prefix}/${slug}${suffix}`;
  if (!(await branchExists(runner, repoPath, base))) return base;

  for (let index = 2; index <= BRANCH_MAX_RETRY_COUNT; index += 1) {
    const candidate = `${base}-${index}`;
    if (!(await branchExists(runner, repoPath, candidate))) return candidate;
  }

  return `${base}-${Date.now().toString(BASE36_RADIX)}`;
}
