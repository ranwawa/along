import { spawn } from 'node:child_process';
import { config, type EditorConfig } from '../core/config';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  type TaskAgentProgressContext,
  writeTaskAgentProgress,
} from './task-agent-progress';
import {
  finishTaskAgentSuccess,
  markTaskAgentFailed,
  type StartedTaskAgentRun,
  saveTaskAgentOutput,
  startTaskAgentRun,
  startTaskAgentRunHeartbeat,
} from './task-agent-run-lifecycle';
import type {
  RunTaskClaudeTurnInput,
  RunTaskClaudeTurnOutput,
} from './task-claude-runner';
import { TASK_AGENT_PROGRESS_PHASE } from './task-planning';

export interface TaskAgentSpawnCommand {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
}

export interface TaskAgentSpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type TaskAgentSpawnRunner = (
  command: TaskAgentSpawnCommand,
) => Promise<Result<TaskAgentSpawnResult>>;

export interface RunTaskSpawnTurnInput extends RunTaskClaudeTurnInput {
  editor: string;
  spawnRunner?: TaskAgentSpawnRunner;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getEditor(editorId: string): Result<EditorConfig> {
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
  input: RunTaskSpawnTurnInput,
): Result<TaskAgentSpawnCommand> {
  const editorRes = getEditor(input.editor);
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

    let stdout = '';
    let stderr = '';
    proc.stdout?.setEncoding('utf-8');
    proc.stderr?.setEncoding('utf-8');
    proc.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    proc.on('error', (error) => {
      resolve(failure(getErrorMessage(error)));
    });
    proc.on('close', (exitCode) => {
      resolve(success({ exitCode: exitCode ?? 1, stdout, stderr }));
    });
    proc.stdin?.on('error', () => {});

    if (command.stdin !== undefined) proc.stdin.end(command.stdin);
    else proc.stdin.end();
  });
}

function summarizeFailure(output: TaskAgentSpawnResult): string {
  const stderr = output.stderr.trim();
  const stdout = output.stdout.trim();
  return stderr || stdout || `命令退出码 ${output.exitCode}`;
}

function getAssistantText(output: TaskAgentSpawnResult): string {
  const stdout = output.stdout.trim();
  if (stdout) return stdout;
  return output.stderr.trim();
}

export async function runTaskSpawnTurn(
  input: RunTaskSpawnTurnInput,
): Promise<Result<RunTaskClaudeTurnOutput>> {
  const prompt = input.prompt.trim();
  if (!prompt) return failure('Task agent prompt 不能为空');

  const commandRes = buildTaskSpawnCommand({ ...input, prompt });
  if (!commandRes.success) return commandRes;

  const editorRes = getEditor(input.editor);
  if (!editorRes.success) return editorRes;
  const permissionRes = ensureEditorPermissions(editorRes.data, input.cwd);
  if (!permissionRes.success) return permissionRes;

  const startedRes = startTaskAgentRun(input, input.editor);
  if (!startedRes.success) return startedRes;

  const stopHeartbeat = startTaskAgentRunHeartbeat(
    startedRes.data.progressContext,
    `Agent 已启动，正在执行 ${editorRes.data.name}。`,
    commandRes.data.cwd,
  );
  const runner = input.spawnRunner || defaultTaskAgentSpawnRunner;
  try {
    return executeSpawnTurn(
      input,
      commandRes.data,
      editorRes.data,
      startedRes.data,
      runner,
    );
  } finally {
    stopHeartbeat();
  }
}

function ensureEditorPermissions(
  editor: EditorConfig,
  cwd: string,
): Result<void> {
  try {
    editor.ensurePermissions?.(cwd, config.USER_ALONG_DIR);
    return success(undefined);
  } catch (error: unknown) {
    return failure(
      `准备 ${editor.name} 权限配置失败: ${getErrorMessage(error)}`,
    );
  }
}

async function executeSpawnTurn(
  input: RunTaskSpawnTurnInput,
  command: TaskAgentSpawnCommand,
  editor: EditorConfig,
  started: StartedTaskAgentRun,
  runner: TaskAgentSpawnRunner,
): Promise<Result<RunTaskClaudeTurnOutput>> {
  writeTaskAgentProgress(
    started.progressContext,
    TASK_AGENT_PROGRESS_PHASE.TOOL,
    '正在等待外部 Agent 命令返回。',
  );
  const executionRes = await runner(command);
  if (!executionRes.success) {
    return failSpawnTurn(
      started.progressContext,
      editor.name,
      executionRes.error,
    );
  }
  return finishSpawnExecution(input, editor, started, executionRes.data);
}

function finishSpawnExecution(
  input: RunTaskSpawnTurnInput,
  editor: EditorConfig,
  started: StartedTaskAgentRun,
  execution: TaskAgentSpawnResult,
): Result<RunTaskClaudeTurnOutput> {
  if (execution.exitCode !== 0) {
    return failSpawnTurn(
      started.progressContext,
      editor.name,
      summarizeFailure(execution),
      '外部 Agent 命令执行失败。',
    );
  }
  const assistantText = getAssistantText(execution);
  const outputRes = saveTaskAgentOutput(
    input,
    input.editor,
    assistantText,
    started.progressContext,
  );
  if (!outputRes.success) return outputRes;
  const finishedRun = finishTaskAgentSuccess(
    started.progressContext,
    outputRes.data,
  );
  if (!finishedRun.success) return finishedRun;
  return success({
    run: finishedRun.data,
    providerSessionId: started.binding.providerSessionId,
    usedResume: started.usedResume,
    assistantText,
    outputArtifactIds: outputRes.data,
  });
}

function failSpawnTurn(
  context: TaskAgentProgressContext,
  editorName: string,
  error: string,
  summary = '外部 Agent 命令启动或执行失败。',
): Result<never> {
  const failedRes = markTaskAgentFailed(context, error, undefined, summary);
  return failedRes.success
    ? failure(`${editorName} 执行失败: ${error}`)
    : failure(failedRes.error);
}
