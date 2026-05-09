import { consola } from 'consola';
import type { Result } from '../core/result';
import { success } from '../core/result';
import {
  type TaskPlanningSnapshot,
  updatePlanningTaskTitle,
} from './task-planning';

const logger = consola.withTag('task-title-summary');
const TITLE_MAX_CHARS = 20;

export interface TaskTitleSummaryInput {
  taskId: string;
  body: string;
  attachmentCount?: number;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function trimByChars(value: string, limit: number): string {
  return [...value].slice(0, limit).join('');
}

export async function generateTaskTitle(body: string): Promise<Result<string>> {
  const normalized = normalizeWhitespace(body);
  return success(
    trimByChars(normalized || 'Untitled Task', TITLE_MAX_CHARS).trim(),
  );
}

export async function runTaskTitleSummary(
  input: TaskTitleSummaryInput,
): Promise<Result<TaskPlanningSnapshot | null>> {
  const titleRes = await generateTaskTitle(input.body);
  if (!titleRes.success) return titleRes;

  const updateRes = updatePlanningTaskTitle({
    taskId: input.taskId,
    title: titleRes.data,
  });
  if (!updateRes.success) return updateRes;

  logger.info(`[Task ${input.taskId}] 标题已更新`);
  return updateRes;
}
