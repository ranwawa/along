import { execSync, spawnSync } from "child_process";

export function runCommand(command: string): string {
  try {
    return execSync(command, { encoding: "utf-8", stdio: "pipe" }).trim();
  } catch (error: any) {
    throw new Error(error.stderr || error.message);
  }
}

export function runSafeCommand(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf-8" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || `Command failed with status ${result.status}`);
  }
  return result.stdout.trim();
}
