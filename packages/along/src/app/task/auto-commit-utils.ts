import type { TaskPlanningSnapshot } from '../planning';

const PORCELAIN_STATUS_PATH_OFFSET = 3;
const TRUNCATION_MARKER = '\n...（中间内容已截断）...\n';
const TRUNCATION_HALF_DIVISOR = 2;
const FAILURE_SUMMARY_MAX_LENGTH = 6000;
const ARTIFACT_LOG_MAX_LENGTH = 80_000;

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
          const file = line.slice(PORCELAIN_STATUS_PATH_OFFSET).trim();
          return file.split(' -> ').pop() || file;
        })
        .filter(Boolean),
    ),
  ].sort();
}

function truncateMiddle(value: string, maxLength: number): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  const half = Math.floor(
    (maxLength - TRUNCATION_MARKER.length) / TRUNCATION_HALF_DIVISOR,
  );
  return `${text.slice(0, half)}${TRUNCATION_MARKER}${text.slice(-half)}`;
}

export function summarizeFailure(error: string): string {
  return truncateMiddle(error, FAILURE_SUMMARY_MAX_LENGTH);
}

export function artifactLog(error: string): string {
  return truncateMiddle(error, ARTIFACT_LOG_MAX_LENGTH);
}
