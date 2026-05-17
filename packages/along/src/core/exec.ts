import { execSync, spawnSync } from 'node:child_process';
import type { Result } from './common';
import { failure, success } from './common';

function getUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getCommandErrorMessage(error: unknown): string {
  const stderr =
    error instanceof Error && 'stderr' in error
      ? (error as { stderr?: unknown }).stderr
      : undefined;
  if (typeof stderr === 'string' && stderr.trim()) return stderr.trim();
  if (Buffer.isBuffer(stderr)) {
    const message = stderr.toString('utf-8').trim();
    if (message) return message;
  }
  return getUnknownErrorMessage(error);
}

export function runCommand(command: string): Result<string> {
  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
    return success(output);
  } catch (error: unknown) {
    return failure(getCommandErrorMessage(error));
  }
}

export function runSafeCommand(
  command: string,
  args: string[],
): Result<string> {
  try {
    const result = spawnSync(command, args, { encoding: 'utf-8' });
    if (result.error) {
      return failure(result.error.message);
    }
    if (result.status !== 0) {
      return failure(
        result.stderr.trim() || `Command failed with status ${result.status}`,
      );
    }
    return success(result.stdout.trim());
  } catch (error: unknown) {
    return failure(getUnknownErrorMessage(error));
  }
}
