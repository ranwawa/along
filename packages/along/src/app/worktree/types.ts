import type { Result } from '../../core/result';

export interface TaskWorktreeCommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export type TaskWorktreeCommandRunner = (
  command: string,
  args: string[],
  options: TaskWorktreeCommandOptions,
) => Promise<Result<string>>;
