import {
  buildPlannerPrompt,
  PLANNER_CONTRACT_KIND,
  PLANNER_NODE_PROMPT_ID,
  PLANNER_NODE_PROMPT_VERSION,
  PLANNER_OUTPUT_FORMAT_SCHEMA,
  PLANNER_OUTPUT_SCHEMA,
  type TaskPlannerAction,
  type TaskPlannerOutput,
} from '../agents/task-planning';
import { loadWorkflowNodePrompt } from '../agents/workflow-node-prompt-loader';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  type RunTaskAgentTurnOutput,
  runTaskAgentTurn,
} from './task-agent-runtime';
import {
  LIFECYCLE,
  publishPlanningUpdate,
  publishTaskPlanRevision,
  readTaskPlanningSnapshot,
  type TaskPlanningSnapshot,
  type TaskRuntimeExecutionMode,
} from './task-planning';

export interface RunTaskPlanningAgentInput {
  taskId: string;
  agentId?: string;
  cwd: string;
  modelId?: string;
  personalityVersion?: string;
  runtimeExecutionMode?: TaskRuntimeExecutionMode;
}

export interface RunTaskPlanningAgentOutput {
  snapshot: TaskPlanningSnapshot;
  action: TaskPlannerAction;
  body: string;
  assistantText: string;
}

function extractJsonCandidate(text: string): string | null {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) return fencedMatch[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1).trim();
  return null;
}

export function parseTaskPlannerOutput(
  text: string,
): Result<TaskPlannerOutput> {
  const raw = text.trim();
  if (!raw) return failure('Planner 输出不能为空');

  const candidate = extractJsonCandidate(raw);
  if (!candidate) return failure('Planner 输出中未找到 JSON');

  try {
    const parsed = JSON.parse(candidate) as unknown;
    const result = PLANNER_OUTPUT_SCHEMA.safeParse(parsed);
    if (!result.success) {
      return failure(`Planner 输出格式不正确: ${result.error.message}`);
    }
    return success(result.data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`解析 Planner 输出失败: ${message}`);
  }
}

function parseTaskPlannerTurnOutput(
  output: RunTaskAgentTurnOutput,
): Result<TaskPlannerOutput> {
  if (output.structuredOutput === undefined) {
    return parseTaskPlannerOutput(output.assistantText);
  }

  const structured = PLANNER_OUTPUT_SCHEMA.safeParse(output.structuredOutput);
  return structured.success
    ? success(structured.data)
    : failure(`Planner 结构化输出格式不正确: ${structured.error.message}`);
}

function publishPlannerOutput(input: {
  taskId: string;
  agentId: string;
  nodePrompt: { name: string; version: string; sourcePath?: string };
  output: TaskPlannerOutput;
}): Result<unknown> {
  if (input.output.action === 'plan_revision') {
    return publishTaskPlanRevision({
      taskId: input.taskId,
      agentId: input.agentId,
      body: input.output.body,
      type: input.output.type,
      metadata: {
        kind: PLANNER_CONTRACT_KIND,
        nodePrompt: input.nodePrompt,
      },
    });
  }

  return publishPlanningUpdate({
    taskId: input.taskId,
    agentId: input.agentId,
    body: input.output.body,
    kind: 'planner_clarification',
  });
}

function readRequiredSnapshot(taskId: string): Result<TaskPlanningSnapshot> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return snapshotRes;
  if (!snapshotRes.data) return failure(`Task 不存在: ${taskId}`);
  return success(snapshotRes.data);
}

function readRefreshedSnapshot(taskId: string): Result<TaskPlanningSnapshot> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return snapshotRes;
  if (!snapshotRes.data) {
    return failure(`Task ${taskId} 已更新，但读取快照失败`);
  }
  return success(snapshotRes.data);
}

async function runPlannerAgentTurn(input: {
  taskInput: RunTaskPlanningAgentInput;
  snapshot: TaskPlanningSnapshot;
  agentId: string;
}) {
  const promptTemplate = loadWorkflowNodePrompt({
    name: PLANNER_NODE_PROMPT_ID,
  });

  return runTaskAgentTurn({
    taskId: input.taskInput.taskId,
    threadId: input.snapshot.thread.threadId,
    agentId: input.agentId,
    prompt: buildPlannerPrompt(input.snapshot, {
      template: promptTemplate.content,
      runtimeExecutionMode: input.taskInput.runtimeExecutionMode,
    }),
    cwd: input.taskInput.cwd,
    modelId: input.taskInput.modelId,
    personalityVersion: input.taskInput.personalityVersion,
    inputArtifactIds: input.snapshot.artifacts.map(
      (artifact) => artifact.artifactId,
    ),
    outputMetadata: {
      kind: 'planner_turn',
      nodePrompt: {
        name: promptTemplate.name,
        version: PLANNER_NODE_PROMPT_VERSION,
        sourcePath: promptTemplate.sourcePath,
      },
    },
    options: {
      outputFormat: {
        type: 'json_schema',
        schema: PLANNER_OUTPUT_FORMAT_SCHEMA,
      },
    },
  });
}

export async function runTaskPlanningAgent(
  input: RunTaskPlanningAgentInput,
): Promise<Result<RunTaskPlanningAgentOutput>> {
  const snapshotRes = readRequiredSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (snapshot.task.lifecycle === LIFECYCLE.DONE) {
    return failure('Task 已关闭，不能运行 Planner');
  }

  const agentId = input.agentId || 'planner';
  const result = await runPlannerAgentTurn({
    taskInput: input,
    snapshot,
    agentId,
  });
  if (!result.success) return result;
  if (result.data.run.status === 'cancelled') {
    return failure('Planner Agent Run 已取消');
  }

  const parsed = parseTaskPlannerTurnOutput(result.data);
  if (!parsed.success) return parsed;

  const publishRes = publishPlannerOutput({
    taskId: input.taskId,
    agentId,
    nodePrompt: {
      name: PLANNER_NODE_PROMPT_ID,
      version: PLANNER_NODE_PROMPT_VERSION,
    },
    output: parsed.data,
  });
  if (!publishRes.success) return publishRes;

  const refreshedSnapshotRes = readRefreshedSnapshot(input.taskId);
  if (!refreshedSnapshotRes.success) return refreshedSnapshotRes;

  return success({
    snapshot: refreshedSnapshotRes.data,
    action: parsed.data.action,
    body: parsed.data.body,
    assistantText: result.data.assistantText,
  });
}
