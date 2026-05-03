import { spawn } from 'node:child_process';
import { config, type EditorConfig } from '../core/config';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import type {
  RunTaskClaudeTurnInput,
  RunTaskClaudeTurnOutput,
} from './task-claude-runner';
import {
  AGENT_RUN_STATUS,
  createTaskAgentRun,
  ensureTaskAgentBinding,
  finishTaskAgentRun,
  recordTaskAgentResult,
} from './task-planning';

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
  try {
    editorRes.data.ensurePermissions?.(input.cwd, config.USER_ALONG_DIR);
  } catch (error: unknown) {
    return failure(
      `准备 ${editorRes.data.name} 权限配置失败: ${getErrorMessage(error)}`,
    );
  }

  const bindingRes = ensureTaskAgentBinding({
    threadId: input.threadId,
    agentId: input.agentId,
    provider: input.editor,
    cwd: input.cwd,
    model: input.model,
    personalityVersion: input.personalityVersion,
  });
  if (!bindingRes.success) return bindingRes;

  const runRes = createTaskAgentRun({
    taskId: input.taskId,
    threadId: input.threadId,
    agentId: input.agentId,
    provider: input.editor,
    providerSessionIdAtStart: bindingRes.data.providerSessionId,
    inputArtifactIds: input.inputArtifactIds,
  });
  if (!runRes.success) return runRes;

  const runner = input.spawnRunner || defaultTaskAgentSpawnRunner;
  const executionRes = await runner(commandRes.data);
  if (!executionRes.success) {
    const failedRun = finishTaskAgentRun({
      runId: runRes.data.runId,
      status: AGENT_RUN_STATUS.FAILED,
      error: executionRes.error,
    });
    if (!failedRun.success) return failedRun;
    return failure(`${editorRes.data.name} 执行失败: ${executionRes.error}`);
  }

  const execution = executionRes.data;
  if (execution.exitCode !== 0) {
    const error = summarizeFailure(execution);
    const failedRun = finishTaskAgentRun({
      runId: runRes.data.runId,
      status: AGENT_RUN_STATUS.FAILED,
      error,
    });
    if (!failedRun.success) return failedRun;
    return failure(`${editorRes.data.name} 执行失败: ${error}`);
  }

  const assistantText = getAssistantText(execution);
  const outputArtifactIds: string[] = [];
  if (assistantText) {
    const artifactRes = recordTaskAgentResult({
      taskId: input.taskId,
      threadId: input.threadId,
      agentId: input.agentId,
      provider: input.editor,
      runId: runRes.data.runId,
      body: assistantText,
    });
    if (!artifactRes.success) {
      const failedRun = finishTaskAgentRun({
        runId: runRes.data.runId,
        status: AGENT_RUN_STATUS.FAILED,
        error: artifactRes.error,
      });
      if (!failedRun.success) return failedRun;
      return failure(artifactRes.error);
    }
    outputArtifactIds.push(artifactRes.data.artifactId);
  }

  const finishedRun = finishTaskAgentRun({
    runId: runRes.data.runId,
    status: AGENT_RUN_STATUS.SUCCEEDED,
    outputArtifactIds,
  });
  if (!finishedRun.success) return finishedRun;

  return success({
    run: finishedRun.data,
    providerSessionId: bindingRes.data.providerSessionId,
    usedResume: Boolean(bindingRes.data.providerSessionId),
    assistantText,
    outputArtifactIds,
  });
}
