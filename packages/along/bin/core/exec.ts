import { execSync, spawnSync } from 'child_process';
import type { Result } from './common';
import { failure, success } from './common';

export function runCommand(command: string): Result<string> {
  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
    return success(output);
  } catch (error: any) {
    return failure(error.stderr || error.message);
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
  } catch (error: any) {
    return failure(error.message);
  }
}
