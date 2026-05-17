import { getDb } from '../../core/db';
import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import type { TaskThreadRow } from './db-rows';
import { buildManualResume } from './flow';
import type {
  TaskAgentBindingRecord,
  TaskAgentRunRecord,
  TaskAgentStageRecord,
  TaskItemRecord,
} from './records';
import type { TaskAgentStage, TaskAgentStageStatus } from './types';
import { TASK_AGENT_STAGE } from './types';

export * from './db-rows';
export * from './db-utils';
export * from './mappers';

const TASK_AGENT_STAGE_DEFINITIONS: Array<{
  stage: TaskAgentStage;
  agentId: string;
  label: string;
}> = [
  { stage: TASK_AGENT_STAGE.PLANNING, agentId: 'planner', label: '计划阶段' },
  { stage: TASK_AGENT_STAGE.EXEC, agentId: 'implementer', label: '实现阶段' },
  { stage: TASK_AGENT_STAGE.DELIVERY, agentId: 'delivery', label: '交付阶段' },
];

function buildStageRecord(
  definition: { stage: TaskAgentStage; agentId: string; label: string },
  runs: TaskAgentRunRecord[],
  bindings: TaskAgentBindingRecord[],
  task: TaskItemRecord,
): TaskAgentStageRecord {
  const latestRun = runs
    .filter((run) => run.agentId === definition.agentId)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  const binding = bindings.find(
    (item) =>
      item.agentId === definition.agentId &&
      (!latestRun || item.runtimeId === latestRun.runtimeId),
  );
  const fallbackBinding = bindings.find(
    (item) => item.agentId === definition.agentId,
  );
  const runtimeId = latestRun?.runtimeId || binding?.runtimeId;
  const sessionId =
    latestRun?.runtimeSessionIdAtEnd ||
    binding?.runtimeSessionId ||
    latestRun?.runtimeSessionIdAtStart;
  const cwd =
    binding?.cwd ||
    fallbackBinding?.cwd ||
    (definition.stage === TASK_AGENT_STAGE.EXEC
      ? task.worktreePath || task.cwd
      : task.cwd || task.worktreePath);
  return {
    ...definition,
    status: (latestRun?.status || 'idle') as TaskAgentStageStatus,
    latestRun,
    manualResume: buildManualResume(runtimeId, cwd, sessionId),
  };
}

export function buildTaskAgentStages(
  runs: TaskAgentRunRecord[],
  bindings: TaskAgentBindingRecord[],
  task: TaskItemRecord,
): TaskAgentStageRecord[] {
  return TASK_AGENT_STAGE_DEFINITIONS.map((definition) =>
    buildStageRecord(definition, runs, bindings, task),
  );
}

export function getActiveThreadRow(
  taskId: string,
): Result<TaskThreadRow | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const row = dbRes.data
      .prepare(
        `
          SELECT tt.*
          FROM task_threads tt
          JOIN task_items ti ON ti.active_thread_id = tt.thread_id
          WHERE ti.task_id = ?
        `,
      )
      .get(taskId) as TaskThreadRow | null;
    return success(row);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`读取 Task Thread 失败: ${message}`);
  }
}
