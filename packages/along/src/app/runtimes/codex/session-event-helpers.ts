import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk';
import type { Result } from '../../../core/result';
import { failure, success } from '../../../core/result';
import type {
  TaskAgentSessionEventKind,
  TaskAgentSessionEventSource,
} from '../../planning';

export const STREAM_CONTENT_LIMIT = 7500;

export interface ItemStreamState {
  text: string;
  output: string;
  todoSnapshot: string;
  toolSnapshot: string;
  wroteText: boolean;
  wroteOutput: boolean;
}

export interface DeltaResult {
  content: string;
  mode: 'delta' | 'snapshot';
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Codex stream 错误';
}

export function getItemState(
  states: Map<string, ItemStreamState>,
  item: ThreadItem,
): ItemStreamState {
  const existing = states.get(item.id);
  if (existing) return existing;
  const created: ItemStreamState = {
    text: '',
    output: '',
    todoSnapshot: '',
    toolSnapshot: '',
    wroteText: false,
    wroteOutput: false,
  };
  states.set(item.id, created);
  return created;
}

export function buildDelta(previous: string, next: string): DeltaResult | null {
  if (next === previous) return null;
  if (next.startsWith(previous)) {
    const content = next.slice(previous.length);
    return content ? { content, mode: 'delta' } : null;
  }
  return next ? { content: next, mode: 'snapshot' } : null;
}

export function truncateContent(
  content: string,
  metadata: Record<string, unknown>,
): { content: string; metadata: Record<string, unknown> } {
  if (content.length <= STREAM_CONTENT_LIMIT) return { content, metadata };
  const omitted = content.length - STREAM_CONTENT_LIMIT;
  return {
    content: `...[已截断 ${omitted} 字符]\n${content.slice(-STREAM_CONTENT_LIMIT)}`,
    metadata: { ...metadata, truncated: true, original_length: content.length },
  };
}

export function baseItemMetadata(
  providerEventType: ThreadEvent['type'],
  item: ThreadItem,
): Record<string, unknown> {
  return {
    provider_event_type: providerEventType,
    item_id: item.id,
    item_type: item.type,
  };
}

export function getItemStatus(item: ThreadItem): string | undefined {
  if ('status' in item && typeof item.status === 'string') return item.status;
  return undefined;
}

export function formatFileChanges(
  item: Extract<ThreadItem, { type: 'file_change' }>,
) {
  if (item.changes.length === 0) return '无文件变更。';
  return item.changes
    .map((change) => `${change.kind}: ${change.path}`)
    .join('\n');
}

export function formatTodoList(
  item: Extract<ThreadItem, { type: 'todo_list' }>,
) {
  if (item.items.length === 0) return 'Codex 任务清单为空。';
  return item.items
    .map((todo) => `${todo.completed ? '[x]' : '[ ]'} ${todo.text}`)
    .join('\n');
}

export function summarizeMcpResult(
  item: Extract<ThreadItem, { type: 'mcp_tool_call' }>,
): string {
  if (item.error?.message) return item.error.message;
  const content = item.result?.content;
  if (!content || content.length === 0) return '工具调用已完成。';
  return `工具调用已完成，返回 ${content.length} 条内容。`;
}

export function buildToolSnapshot(item: ThreadItem): string {
  if (item.type === 'mcp_tool_call') {
    return JSON.stringify({
      status: item.status,
      error: item.error?.message,
      resultCount: item.result?.content.length,
    });
  }
  if (item.type === 'file_change') {
    return JSON.stringify({ status: item.status, changes: item.changes });
  }
  return '';
}

export type RecordFn = (
  source: TaskAgentSessionEventSource,
  kind: TaskAgentSessionEventKind,
  content: string,
  metadata: Record<string, unknown>,
) => Result<void>;

export type ToolThreadItem = Extract<
  ThreadItem,
  { type: 'command_execution' | 'mcp_tool_call' | 'web_search' | 'file_change' }
>;

export type CmdItem = Extract<ThreadItem, { type: 'command_execution' }>;
export type McpItem = Extract<ThreadItem, { type: 'mcp_tool_call' }>;
export type FileItem = Extract<ThreadItem, { type: 'file_change' }>;
export type WebItem = Extract<ThreadItem, { type: 'web_search' }>;

export function cmdMeta(
  t: ThreadEvent['type'],
  item: CmdItem,
): Record<string, unknown> {
  return {
    ...baseItemMetadata(t, item),
    command: item.command,
    status: item.status,
  };
}

export function mcpMeta(
  t: ThreadEvent['type'],
  item: McpItem,
): Record<string, unknown> {
  return {
    ...baseItemMetadata(t, item),
    server: item.server,
    tool: item.tool,
    arguments: item.arguments,
    status: item.status,
  };
}

export function fileMeta(
  t: ThreadEvent['type'],
  item: FileItem,
): Record<string, unknown> {
  return {
    ...baseItemMetadata(t, item),
    status: item.status,
    changes: item.changes,
  };
}

export function webMeta(
  t: ThreadEvent['type'],
  item: WebItem,
): Record<string, unknown> {
  return { ...baseItemMetadata(t, item), query: item.query };
}

export function cmdCompletedMeta(
  t: ThreadEvent['type'],
  item: CmdItem,
): Record<string, unknown> {
  return { ...cmdMeta(t, item), exit_code: item.exit_code };
}

export function mcpCompletedMeta(
  t: ThreadEvent['type'],
  item: McpItem,
): Record<string, unknown> {
  return {
    ...baseItemMetadata(t, item),
    server: item.server,
    tool: item.tool,
    status: item.status,
  };
}

export function cmdCompletedMsg(item: CmdItem): string {
  const suffix =
    item.exit_code === undefined ? '' : `，退出码 ${item.exit_code}`;
  return `命令执行${item.status === 'failed' ? '失败' : '完成'}${suffix}。`;
}

export function fileCompletedMsg(item: FileItem): string {
  return `文件变更${item.status === 'failed' ? '失败' : '完成'}。\n${formatFileChanges(item)}`;
}

export function mcpCompletedMsg(item: McpItem): string {
  return `${item.server}/${item.tool} ${item.status === 'failed' ? '失败' : '完成'}：${summarizeMcpResult(item)}`;
}

type Effect = { latestThreadId?: string };

export function emitTextDelta(
  states: Map<string, ItemStreamState>,
  record: RecordFn,
  providerEventType: ThreadEvent['type'],
  item: Extract<ThreadItem, { type: 'agent_message' | 'reasoning' }>,
): Result<Effect> {
  const state = getItemState(states, item);
  const delta = buildDelta(state.text, item.text);
  state.text = item.text;
  if (!delta) return success({});
  state.wroteText = true;
  const source: TaskAgentSessionEventSource = 'agent';
  const kind: TaskAgentSessionEventKind =
    item.type === 'agent_message' ? 'output' : 'message';
  const res = record(source, kind, delta.content, {
    ...baseItemMetadata(providerEventType, item),
    delta_mode: delta.mode,
  });
  return res.success ? success({}) : failure(res.error);
}

export function emitCompletionTextIfNeeded(
  states: Map<string, ItemStreamState>,
  record: RecordFn,
  providerEventType: ThreadEvent['type'],
  item: Extract<ThreadItem, { type: 'agent_message' | 'reasoning' }>,
): Result<Effect> {
  const state = getItemState(states, item);
  if (state.wroteText || !item.text) return success({});
  return emitTextDelta(states, record, providerEventType, item);
}

export function emitCommandOutputDelta(
  states: Map<string, ItemStreamState>,
  record: RecordFn,
  providerEventType: ThreadEvent['type'],
  item: Extract<ThreadItem, { type: 'command_execution' }>,
): Result<Effect> {
  const state = getItemState(states, item);
  const delta = buildDelta(state.output, item.aggregated_output);
  state.output = item.aggregated_output;
  if (!delta) return success({});
  state.wroteOutput = true;
  const res = record('stdout', 'output', delta.content, {
    ...baseItemMetadata(providerEventType, item),
    command: item.command,
    status: item.status,
    exit_code: item.exit_code,
    delta_mode: delta.mode,
  });
  return res.success ? success({}) : failure(res.error);
}

export function emitTodoSnapshot(
  states: Map<string, ItemStreamState>,
  record: RecordFn,
  providerEventType: ThreadEvent['type'],
  item: Extract<ThreadItem, { type: 'todo_list' }>,
): Result<Effect> {
  const state = getItemState(states, item);
  const snapshot = formatTodoList(item);
  if (snapshot === state.todoSnapshot) return success({});
  state.todoSnapshot = snapshot;
  const res = record('tool', 'message', snapshot, {
    ...baseItemMetadata(providerEventType, item),
    delta_mode: 'snapshot',
  });
  return res.success ? success({}) : failure(res.error);
}

export function emitToolSnapshot(
  states: Map<string, ItemStreamState>,
  record: RecordFn,
  providerEventType: ThreadEvent['type'],
  item: Extract<ThreadItem, { type: 'mcp_tool_call' | 'file_change' }>,
): Result<Effect> {
  const state = getItemState(states, item);
  const snapshot = buildToolSnapshot(item);
  if (snapshot === state.toolSnapshot) return success({});
  state.toolSnapshot = snapshot;
  const status = getItemStatus(item);
  const content =
    item.type === 'mcp_tool_call'
      ? `${item.server}/${item.tool} 状态：${status || 'unknown'}`
      : `文件变更状态：${status || 'unknown'}\n${formatFileChanges(item)}`;
  const res = record('tool', 'progress', content, {
    ...baseItemMetadata(providerEventType, item),
    status,
    delta_mode: 'snapshot',
  });
  return res.success ? success({}) : failure(res.error);
}
