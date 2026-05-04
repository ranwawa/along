import type { TaskPlanningSnapshot } from './task-planning';
import type { TaskWorktreeCommandRunner } from './task-worktree';

export interface RunTaskAutoCommitInput {
  snapshot: TaskPlanningSnapshot;
  worktreePath: string;
  branchName: string;
  defaultBranch: string;
  commandRunner: TaskWorktreeCommandRunner;
  assistantText?: string;
}

export interface RunTaskAutoCommitOutput {
  commitShas: string[];
  changedFiles: string[];
  commitMessage: string;
  alreadyCommitted: boolean;
}

export interface TaskAutoCommitFailure {
  success: false;
  error: string;
  command: string;
  summary: string;
  changedFiles: string[];
  failureArtifactId?: string;
}

export type TaskAutoCommitResult =
  | { success: true; data: RunTaskAutoCommitOutput }
  | TaskAutoCommitFailure;
