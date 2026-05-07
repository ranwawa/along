import { config, type EditorConfig } from '../core/config';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  type TaskAgentProgressContext,
  writeTaskAgentProgress,
  writeTaskAgentSessionEvent,
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
import {
  appendImagePathsToPrompt,
  resolveAndRecordInputImages,
} from './task-runner-images';
import {
  buildTaskSpawnCommand,
  defaultTaskAgentSpawnRunner,
  getTaskAgentEditor,
  type TaskAgentSpawnCommand,
  type TaskAgentSpawnResult,
  type TaskAgentSpawnRunner,
} from './task-spawn-command';

export { buildTaskSpawnCommand } from './task-spawn-command';

export interface RunTaskSpawnTurnInput extends RunTaskClaudeTurnInput {
  editor: string;
  spawnRunner?: TaskAgentSpawnRunner;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  const editorRes = getTaskAgentEditor(input.editor);
  if (!editorRes.success) return editorRes;
  const permissionRes = ensureEditorPermissions(editorRes.data, input.cwd);
  if (!permissionRes.success) return permissionRes;

  const startedRes = startTaskAgentRun(input, input.editor);
  if (!startedRes.success) return startedRes;
  const commandRes = await prepareSpawnCommand(input, prompt, startedRes.data);
  if (!commandRes.success) {
    return failSpawnTurn(
      startedRes.data.progressContext,
      editorRes.data.name,
      commandRes.error,
    );
  }
  const runner = input.spawnRunner || defaultTaskAgentSpawnRunner;
  return runPreparedSpawnCommand(
    input,
    commandRes.data,
    editorRes.data,
    startedRes.data,
    runner,
  );
}

function runPreparedSpawnCommand(
  input: RunTaskSpawnTurnInput,
  command: TaskAgentSpawnCommand,
  editor: EditorConfig,
  started: StartedTaskAgentRun,
  runner: TaskAgentSpawnRunner,
) {
  const stopHeartbeat = startSpawnHeartbeat(started, editor.name, command.cwd);
  try {
    const streamState = { seen: false };
    return executeSpawnTurn(
      input,
      command,
      editor,
      started,
      runner,
      streamState,
    );
  } finally {
    stopHeartbeat();
  }
}

async function prepareSpawnCommand(
  input: RunTaskSpawnTurnInput,
  prompt: string,
  started: StartedTaskAgentRun,
): Promise<Result<TaskAgentSpawnCommand>> {
  const imagesRes = await resolveAndRecordInputImages({
    taskId: input.taskId,
    inputArtifactIds: input.inputArtifactIds,
    context: started.progressContext,
    summary: '本轮传入 {count} 张用户上传图片路径。',
  });
  if (!imagesRes.success) return failure(imagesRes.error);
  return buildTaskSpawnCommand({
    ...input,
    prompt: appendImagePathsToPrompt(prompt, imagesRes.data),
  });
}

function startSpawnHeartbeat(
  started: StartedTaskAgentRun,
  editorName: string,
  cwd: string,
) {
  return startTaskAgentRunHeartbeat(
    started.progressContext,
    `Agent 已启动，正在执行 ${editorName}。`,
    cwd,
  );
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
  streamState: { seen: boolean },
): Promise<Result<RunTaskClaudeTurnOutput>> {
  writeTaskAgentProgress(
    started.progressContext,
    TASK_AGENT_PROGRESS_PHASE.TOOL,
    '正在等待外部 Agent 命令返回。',
  );
  const executionRes = await runner(
    withSessionStreamCallbacks(command, started.progressContext, streamState),
  );
  if (!executionRes.success) {
    return failSpawnTurn(
      started.progressContext,
      editor.name,
      executionRes.error,
    );
  }
  return finishSpawnExecution(
    input,
    editor,
    started,
    executionRes.data,
    streamState.seen,
  );
}

function withSessionStreamCallbacks(
  command: TaskAgentSpawnCommand,
  context: TaskAgentProgressContext,
  streamState: { seen: boolean },
): TaskAgentSpawnCommand {
  return {
    ...command,
    onStdout: (chunk) => {
      streamState.seen = true;
      command.onStdout?.(chunk);
      writeTaskAgentSessionEvent(context, 'stdout', 'output', chunk, {
        stream: 'stdout',
      });
    },
    onStderr: (chunk) => {
      streamState.seen = true;
      command.onStderr?.(chunk);
      writeTaskAgentSessionEvent(context, 'stderr', 'error', chunk, {
        stream: 'stderr',
      });
    },
  };
}

function finishSpawnExecution(
  input: RunTaskSpawnTurnInput,
  editor: EditorConfig,
  started: StartedTaskAgentRun,
  execution: TaskAgentSpawnResult,
  hadStreamEvents: boolean,
): Result<RunTaskClaudeTurnOutput> {
  if (!hadStreamEvents) writeSpawnFinalSessionEvent(started, execution);
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

function writeSpawnFinalSessionEvent(
  started: StartedTaskAgentRun,
  execution: TaskAgentSpawnResult,
) {
  const stdout = execution.stdout.trim();
  const stderr = execution.stderr.trim();
  if (stdout) {
    writeTaskAgentSessionEvent(
      started.progressContext,
      'stdout',
      'output',
      stdout,
      { stream: 'stdout', final: true },
    );
  }
  if (stderr) {
    writeTaskAgentSessionEvent(
      started.progressContext,
      'stderr',
      execution.exitCode === 0 ? 'output' : 'error',
      stderr,
      { stream: 'stderr', final: true },
    );
  }
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
