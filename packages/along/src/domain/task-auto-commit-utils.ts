import type { TaskPlanningSnapshot } from './task-planning';

const CONVENTIONAL_TYPES = new Set([
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'chore',
  'ci',
]);

function normalizeTitle(title: string, maxLength = 52): string {
  const text = title.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function normalizeCommitType(type?: string): string {
  const normalized = type?.trim().toLowerCase();
  return normalized && CONVENTIONAL_TYPES.has(normalized) ? normalized : 'feat';
}

export function buildCommitMessage(snapshot: TaskPlanningSnapshot): string {
  return `${normalizeCommitType(snapshot.task.type)}(task): 完成${normalizeTitle(
    snapshot.task.title,
  )}`;
}

export function parseChangedFiles(status: string): string[] {
  return [
    ...new Set(
      status
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => {
          const file = line.slice(3).trim();
          return file.split(' -> ').pop() || file;
        })
        .filter(Boolean),
    ),
  ].sort();
}

function truncateMiddle(value: string, maxLength: number): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  const half = Math.floor((maxLength - 36) / 2);
  return `${text.slice(0, half)}\n...（中间内容已截断）...\n${text.slice(
    -half,
  )}`;
}

export function summarizeFailure(error: string): string {
  return truncateMiddle(error, 6000);
}

export function artifactLog(error: string): string {
  return truncateMiddle(error, 80_000);
}
