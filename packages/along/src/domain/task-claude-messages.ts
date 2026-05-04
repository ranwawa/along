import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { TASK_AGENT_PROGRESS_PHASE } from './task-planning';

type MessageWithSession = SDKMessage & { session_id?: string };
type UnknownRecord = Record<string, unknown>;

export interface ClaudeProgressSummary {
  phase: (typeof TASK_AGENT_PROGRESS_PHASE)[keyof typeof TASK_AGENT_PROGRESS_PHASE];
  summary: string;
  detail?: string;
}

export interface ClaudeSessionEventSummary {
  source: 'system' | 'agent' | 'tool';
  kind: 'message' | 'output' | 'error';
  content: string;
  metadata: Record<string, unknown>;
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getSessionId(message: SDKMessage): string | undefined {
  const candidate = message as MessageWithSession;
  return typeof candidate.session_id === 'string'
    ? candidate.session_id
    : undefined;
}

export function getResultError(message: SDKMessage): string | null {
  const result = message as {
    type?: string;
    is_error?: boolean;
    errors?: unknown;
    subtype?: string;
  };
  if (result.type !== 'result') return null;
  if (result.is_error !== true) return null;
  return formatResultError(result.errors, result.subtype);
}

function formatResultError(errors: unknown, subtype?: string): string {
  if (Array.isArray(errors)) {
    const message = errors
      .filter((item): item is string => typeof item === 'string')
      .join(', ');
    return message || 'Claude Agent 返回错误结果';
  }
  return typeof subtype === 'string'
    ? `Claude Agent 返回错误结果: ${subtype}`
    : 'Claude Agent 返回错误结果';
}

function collectTextBlocks(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (!isRecord(block)) return [];
    return block.type === 'text' && typeof block.text === 'string'
      ? [block.text]
      : [];
  });
}

export function getAssistantMessageText(message: SDKMessage): string[] {
  const record: unknown = message;
  if (!isRecord(record) || record.type !== 'assistant') return [];
  if (!isRecord(record.message)) return [];
  return collectTextBlocks(record.message.content);
}

export function getResultText(message: SDKMessage): string | undefined {
  const record: unknown = message;
  if (!isRecord(record) || record.type !== 'result') return undefined;
  return typeof record.result === 'string' ? record.result : undefined;
}

export function getResultStructuredOutput(message: SDKMessage): unknown {
  const record: unknown = message;
  if (!isRecord(record) || record.type !== 'result') return undefined;
  return record.structured_output;
}

export function summarizeClaudeSessionEvent(
  message: SDKMessage,
): ClaudeSessionEventSummary | null {
  const record: unknown = message;
  if (!isRecord(record)) return null;
  const type = typeof record.type === 'string' ? record.type : 'unknown';
  if (type === 'system') return summarizeClaudeSystemEvent(record);
  if (type === 'assistant') return summarizeClaudeAssistantEvent(record);
  if (type === 'tool_use_summary') {
    return {
      source: 'tool',
      kind: 'message',
      content: stringifyBriefRecord(record),
      metadata: { type },
    };
  }
  if (type === 'rate_limit_event') {
    return {
      source: 'system',
      kind: 'message',
      content: 'Agent 遇到服务限流，正在等待恢复。',
      metadata: { type },
    };
  }
  if (type === 'result') return summarizeClaudeResultEvent(record);
  return null;
}

function summarizeClaudeSystemEvent(
  record: UnknownRecord,
): ClaudeSessionEventSummary {
  const sessionId =
    typeof record.session_id === 'string' ? record.session_id : undefined;
  return {
    source: 'system',
    kind: 'message',
    content: sessionId
      ? `Agent session 已连接：${sessionId}`
      : 'Agent session 已连接。',
    metadata: { type: 'system', sessionId },
  };
}

function summarizeClaudeAssistantEvent(
  record: UnknownRecord,
): ClaudeSessionEventSummary | null {
  if (!isRecord(record.message)) return null;
  const text = collectTextBlocks(record.message.content).join('\n\n').trim();
  if (!text) return null;
  return {
    source: 'agent',
    kind: 'output',
    content: text,
    metadata: { type: 'assistant' },
  };
}

function summarizeClaudeResultEvent(
  record: UnknownRecord,
): ClaudeSessionEventSummary {
  const error = getResultError(record as SDKMessage);
  if (error) {
    return {
      source: 'system',
      kind: 'error',
      content: error,
      metadata: { type: 'result', subtype: record.subtype },
    };
  }
  return {
    source: 'system',
    kind: 'message',
    content:
      typeof record.result === 'string' && record.result.trim()
        ? record.result
        : 'Agent 已返回最终结果。',
    metadata: { type: 'result', subtype: record.subtype },
  };
}

function stringifyBriefRecord(record: UnknownRecord): string {
  const text = JSON.stringify(record, null, 2);
  return text.length > 2000 ? `${text.slice(0, 2000)}\n...[已截断]` : text;
}

export function summarizeClaudeProgress(
  message: SDKMessage,
): ClaudeProgressSummary | null {
  const record: unknown = message;
  if (!isRecord(record)) return null;
  if (record.type === 'system' && typeof record.session_id === 'string') {
    return {
      phase: TASK_AGENT_PROGRESS_PHASE.CONTEXT,
      summary: '已连接 Agent 会话，正在加载上下文。',
      detail: '会话已建立或恢复，准备继续执行任务。',
    };
  }
  return summarizeClaudeProgressType(record.type);
}

function summarizeClaudeProgressType(
  type: unknown,
): ClaudeProgressSummary | null {
  if (type === 'assistant') {
    return {
      phase: TASK_AGENT_PROGRESS_PHASE.FINALIZING,
      summary: 'Agent 已产出阶段性内容，正在继续处理。',
    };
  }
  if (type === 'tool_use_summary') {
    return {
      phase: TASK_AGENT_PROGRESS_PHASE.TOOL,
      summary: 'Agent 正在执行工具或命令。',
    };
  }
  if (type === 'rate_limit_event') {
    return {
      phase: TASK_AGENT_PROGRESS_PHASE.WAITING,
      summary: 'Agent 正在等待服务限流恢复。',
    };
  }
  if (type === 'result') {
    return {
      phase: TASK_AGENT_PROGRESS_PHASE.FINALIZING,
      summary: 'Agent 已返回结果，正在整理输出。',
    };
  }
  return null;
}
