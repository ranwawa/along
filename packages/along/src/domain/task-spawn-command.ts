import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';
import { config, type EditorConfig } from '../core/config';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';

const SPAWN_CANCEL_KILL_GRACE_MS = 3000;

export interface TaskAgentSpawnCommand {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  abortSignal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface TaskAgentSpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type TaskAgentSpawnRunner = (
  command: TaskAgentSpawnCommand,
) => Promise<Result<TaskAgentSpawnResult>>;

export interface TaskSpawnCommandInput {
  editor: string;
  prompt: string;
  cwd: string;
  model?: string;
  personalityVersion?: string;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function terminateSpawnProcess(proc: ChildProcessWithoutNullStreams) {
  if (proc.killed) return;
  proc.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (!proc.killed) proc.kill('SIGKILL');
  }, SPAWN_CANCEL_KILL_GRACE_MS);
  timer.unref?.();
  proc.once('close', () => clearTimeout(timer));
}

export function getTaskAgentEditor(editorId: string): Result<EditorConfig> {
  const editor = config.EDITORS.find((item) => item.id === editorId);
  return editor
    ? success(editor)
    : failure(`未知 Task agent editor: ${editorId}`);
}

function pushModel(args: string[], flag: string, model?: string) {
  if (!model) return;
  args.push(flag, model);
}

export function buildTaskSpawnCommand(
  input: TaskSpawnCommandInput,
): Result<TaskAgentSpawnCommand> {
  const editorRes = getTaskAgentEditor(input.editor);
  if (!editorRes.success) return editorRes;

  switch (editorRes.data.id) {
    case 'opencode': {
      const args = ['run'];
      pushModel(args, '--model', input.model);
      if (input.personalityVersion) {
        args.push('--agent', input.personalityVersion);
      }
      args.push(input.prompt);
      return success({ command: 'opencode', args, cwd: input.cwd });
    }
    case 'pi': {
      const args = ['--print'];
      pushModel(args, '--model', input.model);
      args.push(input.prompt);
      return success({ command: 'pi', args, cwd: input.cwd });
    }
    default:
      return failure(
        `Task agent editor "${editorRes.data.id}" 暂未实现 CLI runner`,
      );
  }
}

export async function defaultTaskAgentSpawnRunner(
  command: TaskAgentSpawnCommand,
): Promise<Result<TaskAgentSpawnResult>> {
  return new Promise((resolve) => {
    const proc = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: process.env,
    });
    const abort = () => terminateSpawnProcess(proc);
    if (command.abortSignal?.aborted) abort();
    command.abortSignal?.addEventListener('abort', abort, { once: true });

    let stdout = '';
    let stderr = '';
    proc.stdout?.setEncoding('utf-8');
    proc.stderr?.setEncoding('utf-8');
    proc.stdout?.on('data', (chunk) => {
      stdout += chunk;
      command.onStdout?.(chunk);
    });
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk;
      command.onStderr?.(chunk);
    });
    proc.on('error', (error) => {
      command.abortSignal?.removeEventListener('abort', abort);
      resolve(failure(getErrorMessage(error)));
    });
    proc.on('close', (exitCode) => {
      command.abortSignal?.removeEventListener('abort', abort);
      resolve(success({ exitCode: exitCode ?? 1, stdout, stderr }));
    });
    proc.stdin?.on('error', () => {});

    if (command.stdin !== undefined) proc.stdin.end(command.stdin);
    else proc.stdin.end();
  });
}
