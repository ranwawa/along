import crypto from 'node:crypto';
import type {
  Lifecycle,
  TaskExecutionMode,
  TaskWorkspaceMode,
  WorkflowKind,
} from './task-planning-types';
import {
  LIFECYCLE,
  TASK_EXECUTION_MODE,
  TASK_WORKSPACE_MODE,
  WORKFLOW_KIND,
} from './task-planning-types';

const ID_SUFFIX_LENGTH = 12;

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, ID_SUFFIX_LENGTH)}`;
}

export function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export function normalizeTaskExecutionMode(
  value: string | null | undefined,
): TaskExecutionMode {
  return value === TASK_EXECUTION_MODE.AUTONOMOUS
    ? TASK_EXECUTION_MODE.AUTONOMOUS
    : TASK_EXECUTION_MODE.MANUAL;
}

export function normalizeTaskWorkspaceMode(
  value: string | null | undefined,
): TaskWorkspaceMode {
  return value === TASK_WORKSPACE_MODE.DEFAULT_BRANCH
    ? TASK_WORKSPACE_MODE.DEFAULT_BRANCH
    : TASK_WORKSPACE_MODE.WORKTREE;
}

export function normalizeWorkflowKind(
  value: string | null | undefined,
): WorkflowKind {
  if (value === WORKFLOW_KIND.PLAN) return WORKFLOW_KIND.PLAN;
  if (value === WORKFLOW_KIND.EXEC) return WORKFLOW_KIND.EXEC;
  return WORKFLOW_KIND.PLAN;
}

export function normalizeLifecycle(
  value: string | null | undefined,
): Lifecycle {
  if (
    value === LIFECYCLE.ACTIVE ||
    value === LIFECYCLE.WAITING ||
    value === LIFECYCLE.DONE ||
    value === LIFECYCLE.FAILED
  ) {
    return value;
  }
  return LIFECYCLE.ACTIVE;
}

export function parseMetadata(
  value: string | null | undefined,
): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export const SESSION_EVENT_CONTENT_LIMIT = 8000;
export const SECRET_VALUE = '[REDACTED]';

export function redactSensitiveContent(value: string): string {
  return value
    .replace(
      /\b(?:ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[baprs])_[A-Za-z0-9_=-]{16,}\b/g,
      SECRET_VALUE,
    )
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, SECRET_VALUE)
    .replace(
      /\b((?:api[_-]?key|token|secret|password|authorization|bearer)\s*[:=]\s*["']?)([^\s"',;]+)/gi,
      `$1${SECRET_VALUE}`,
    )
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)[A-Z0-9_]*\s*=\s*)([^\s]+)/g,
      `$1${SECRET_VALUE}`,
    );
}

export function normalizeSessionEventContent(value: string): string {
  const redacted = redactSensitiveContent(value.trim());
  if (redacted.length <= SESSION_EVENT_CONTENT_LIMIT) return redacted;
  const omitted = redacted.length - SESSION_EVENT_CONTENT_LIMIT;
  return `${redacted.slice(0, SESSION_EVENT_CONTENT_LIMIT)}\n...[已截断 ${omitted} 字符]`;
}
