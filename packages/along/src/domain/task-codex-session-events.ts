// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: Codex stream event mapping keeps provider cases explicit.
// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: Codex stream event mapping keeps provider cases explicit.
import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import type { TaskAgentProgressContext } from './task-agent-progress';
import {
  recordTaskAgentProgress,
  recordTaskAgentSessionEvent,
  TASK_AGENT_PROGRESS_PHASE,
  type TaskAgentSessionEventKind,
  type TaskAgentSessionEventSource,
} from './task-planning';

const STREAM_CONTENT_LIMIT = 7500;

interface ItemStreamState {
  text: string;
  output: string;
  todoSnapshot: string;
  toolSnapshot: string;
  wroteText: boolean;
  wroteOutput: boolean;
}

interface CodexStreamEventEffect {
  latestThreadId?: string;
}

interface DeltaResult {
  content: string;
  mode: 'delta' | 'snapshot';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Codex stream 错误';
}

function getItemState(
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

function buildDelta(previous: string, next: string): DeltaResult | null {
  if (next === previous) return null;
  if (next.startsWith(previous)) {
    const content = next.slice(previous.length);
    return content ? { content, mode: 'delta' } : null;
  }
  return next ? { content: next, mode: 'snapshot' } : null;
}

function truncateContent(
  content: string,
  metadata: Record<string, unknown>,
): { content: string; metadata: Record<string, unknown> } {
  if (content.length <= STREAM_CONTENT_LIMIT) return { content, metadata };
  const omitted = content.length - STREAM_CONTENT_LIMIT;
  return {
    content: `...[已截断 ${omitted} 字符]\n${content.slice(-STREAM_CONTENT_LIMIT)}`,
    metadata: {
      ...metadata,
      truncated: true,
      original_length: content.length,
    },
  };
}

function baseItemMetadata(
  providerEventType: ThreadEvent['type'],
  item: ThreadItem,
): Record<string, unknown> {
  return {
    provider_event_type: providerEventType,
    item_id: item.id,
    item_type: item.type,
  };
}

function getItemStatus(item: ThreadItem): string | undefined {
  if ('status' in item && typeof item.status === 'string') return item.status;
  return undefined;
}

function formatFileChanges(item: Extract<ThreadItem, { type: 'file_change' }>) {
  if (item.changes.length === 0) return '无文件变更。';
  return item.changes
    .map((change) => `${change.kind}: ${change.path}`)
    .join('\n');
}

function formatTodoList(item: Extract<ThreadItem, { type: 'todo_list' }>) {
  if (item.items.length === 0) return 'Codex 任务清单为空。';
  return item.items
    .map((todo) => `${todo.completed ? '[x]' : '[ ]'} ${todo.text}`)
    .join('\n');
}

function summarizeMcpResult(
  item: Extract<ThreadItem, { type: 'mcp_tool_call' }>,
): string {
  if (item.error?.message) return item.error.message;
  const content = item.result?.content;
  if (!content || content.length === 0) return '工具调用已完成。';
  return `工具调用已完成，返回 ${content.length} 条内容。`;
}

function buildToolSnapshot(item: ThreadItem): string {
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

export class CodexStreamSessionEventMapper {
  private readonly itemStates = new Map<string, ItemStreamState>();

  constructor(private readonly context: TaskAgentProgressContext) {}

  handleEvent(event: ThreadEvent): Result<CodexStreamEventEffect> {
    switch (event.type) {
      case 'thread.started': {
        const sessionRes = this.recordSession(
          'system',
          'message',
          'Codex thread 已连接。',
          {
            provider_event_type: event.type,
            thread_id: event.thread_id,
          },
        );
        return sessionRes.success
          ? success({ latestThreadId: event.thread_id })
          : failure(sessionRes.error);
      }
      case 'turn.started':
        return this.handleTurnStarted(event.type);
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        return this.handleItemEvent(event.type, event.item);
      case 'turn.completed':
        return this.handleTurnCompleted(event);
      case 'turn.failed':
        return this.toEffect(
          this.recordSession(
            'system',
            'error',
            `Codex turn 失败：${getErrorMessage(event.error.message)}`,
            {
              provider_event_type: event.type,
              error: event.error.message,
            },
          ),
        );
      case 'error':
        return this.toEffect(
          this.recordSession(
            'system',
            'error',
            `Codex stream 错误：${getErrorMessage(event.message)}`,
            {
              provider_event_type: event.type,
              error: event.message,
            },
          ),
        );
    }
  }

  private toEffect(result: Result<void>): Result<CodexStreamEventEffect> {
    return result.success ? success({}) : failure(result.error);
  }

  private handleTurnStarted(
    providerEventType: ThreadEvent['type'],
  ): Result<CodexStreamEventEffect> {
    const progressRes = recordTaskAgentProgress({
      ...this.context,
      phase: TASK_AGENT_PROGRESS_PHASE.WAITING,
      summary: 'Codex 已开始处理本轮请求。',
    });
    if (!progressRes.success) return failure(progressRes.error);
    const sessionRes = this.recordSession(
      'system',
      'progress',
      'Codex 已开始处理本轮请求。',
      { provider_event_type: providerEventType },
    );
    return sessionRes.success ? success({}) : failure(sessionRes.error);
  }

  private handleTurnCompleted(
    event: Extract<ThreadEvent, { type: 'turn.completed' }>,
  ): Result<CodexStreamEventEffect> {
    const progressRes = recordTaskAgentProgress({
      ...this.context,
      phase: TASK_AGENT_PROGRESS_PHASE.FINALIZING,
      summary: 'Codex 已完成本轮请求，正在保存输出。',
    });
    if (!progressRes.success) return failure(progressRes.error);
    const sessionRes = this.recordSession(
      'system',
      'message',
      'Codex turn 已完成。',
      {
        provider_event_type: event.type,
        usage: event.usage,
      },
    );
    return sessionRes.success ? success({}) : failure(sessionRes.error);
  }

  private handleItemEvent(
    providerEventType: Extract<
      ThreadEvent['type'],
      'item.started' | 'item.updated' | 'item.completed'
    >,
    item: ThreadItem,
  ): Result<CodexStreamEventEffect> {
    if (providerEventType === 'item.started') {
      return this.handleItemStarted(providerEventType, item);
    }
    if (providerEventType === 'item.updated') {
      return this.handleItemUpdated(providerEventType, item);
    }
    return this.handleItemCompleted(providerEventType, item);
  }

  private handleItemStarted(
    providerEventType: ThreadEvent['type'],
    item: ThreadItem,
  ): Result<CodexStreamEventEffect> {
    getItemState(this.itemStates, item);
    switch (item.type) {
      case 'agent_message':
      case 'reasoning':
        return item.text
          ? this.emitTextDelta(providerEventType, item)
          : success({});
      case 'command_execution':
        return this.toEffect(
          this.recordSession(
            'tool',
            'progress',
            `开始执行命令：\n${item.command}`,
            {
              ...baseItemMetadata(providerEventType, item),
              command: item.command,
              status: item.status,
            },
          ),
        );
      case 'mcp_tool_call':
        return this.toEffect(
          this.recordSession(
            'tool',
            'progress',
            `开始调用工具：${item.server}/${item.tool}`,
            {
              ...baseItemMetadata(providerEventType, item),
              server: item.server,
              tool: item.tool,
              arguments: item.arguments,
              status: item.status,
            },
          ),
        );
      case 'web_search':
        return this.toEffect(
          this.recordSession('tool', 'progress', `开始搜索：${item.query}`, {
            ...baseItemMetadata(providerEventType, item),
            query: item.query,
          }),
        );
      case 'file_change':
        return this.toEffect(
          this.recordSession(
            'tool',
            'progress',
            `文件变更开始处理。\n${formatFileChanges(item)}`,
            {
              ...baseItemMetadata(providerEventType, item),
              status: item.status,
              changes: item.changes,
            },
          ),
        );
      case 'todo_list':
        return this.emitTodoSnapshot(providerEventType, item);
      case 'error':
        return this.toEffect(
          this.recordSession('system', 'error', item.message, {
            ...baseItemMetadata(providerEventType, item),
          }),
        );
    }
  }

  private handleItemUpdated(
    providerEventType: ThreadEvent['type'],
    item: ThreadItem,
  ): Result<CodexStreamEventEffect> {
    switch (item.type) {
      case 'agent_message':
      case 'reasoning':
        return this.emitTextDelta(providerEventType, item);
      case 'command_execution':
        return this.emitCommandOutputDelta(providerEventType, item);
      case 'todo_list':
        return this.emitTodoSnapshot(providerEventType, item);
      case 'mcp_tool_call':
      case 'file_change':
        return this.emitToolSnapshot(providerEventType, item);
      case 'web_search':
        return success({});
      case 'error':
        return this.toEffect(
          this.recordSession('system', 'error', item.message, {
            ...baseItemMetadata(providerEventType, item),
          }),
        );
    }
  }

  private handleItemCompleted(
    providerEventType: ThreadEvent['type'],
    item: ThreadItem,
  ): Result<CodexStreamEventEffect> {
    switch (item.type) {
      case 'agent_message':
      case 'reasoning':
        return this.emitCompletionTextIfNeeded(providerEventType, item);
      case 'command_execution':
        return this.toEffect(
          this.recordSession(
            item.status === 'failed' ? 'stderr' : 'tool',
            item.status === 'failed' ? 'error' : 'message',
            `命令执行${item.status === 'failed' ? '失败' : '完成'}${
              item.exit_code === undefined ? '' : `，退出码 ${item.exit_code}`
            }。`,
            {
              ...baseItemMetadata(providerEventType, item),
              command: item.command,
              status: item.status,
              exit_code: item.exit_code,
            },
          ),
        );
      case 'file_change':
        return this.toEffect(
          this.recordSession(
            item.status === 'failed' ? 'stderr' : 'tool',
            item.status === 'failed' ? 'error' : 'message',
            `文件变更${item.status === 'failed' ? '失败' : '完成'}。\n${formatFileChanges(
              item,
            )}`,
            {
              ...baseItemMetadata(providerEventType, item),
              status: item.status,
              changes: item.changes,
            },
          ),
        );
      case 'mcp_tool_call':
        return this.toEffect(
          this.recordSession(
            item.status === 'failed' ? 'stderr' : 'tool',
            item.status === 'failed' ? 'error' : 'message',
            `${item.server}/${item.tool} ${item.status === 'failed' ? '失败' : '完成'}：${summarizeMcpResult(
              item,
            )}`,
            {
              ...baseItemMetadata(providerEventType, item),
              server: item.server,
              tool: item.tool,
              status: item.status,
            },
          ),
        );
      case 'web_search':
        return this.toEffect(
          this.recordSession('tool', 'message', `搜索完成：${item.query}`, {
            ...baseItemMetadata(providerEventType, item),
            query: item.query,
          }),
        );
      case 'todo_list':
        return this.emitTodoSnapshot(providerEventType, item);
      case 'error':
        return this.toEffect(
          this.recordSession('system', 'error', item.message, {
            ...baseItemMetadata(providerEventType, item),
          }),
        );
    }
  }

  private emitCompletionTextIfNeeded(
    providerEventType: ThreadEvent['type'],
    item: Extract<ThreadItem, { type: 'agent_message' | 'reasoning' }>,
  ): Result<CodexStreamEventEffect> {
    const state = getItemState(this.itemStates, item);
    if (state.wroteText || !item.text) return success({});
    return this.emitTextDelta(providerEventType, item);
  }

  private emitTextDelta(
    providerEventType: ThreadEvent['type'],
    item: Extract<ThreadItem, { type: 'agent_message' | 'reasoning' }>,
  ): Result<CodexStreamEventEffect> {
    const state = getItemState(this.itemStates, item);
    const delta = buildDelta(state.text, item.text);
    state.text = item.text;
    if (!delta) return success({});
    state.wroteText = true;
    const source: TaskAgentSessionEventSource = 'agent';
    const kind: TaskAgentSessionEventKind =
      item.type === 'agent_message' ? 'output' : 'message';
    const sessionRes = this.recordSession(source, kind, delta.content, {
      ...baseItemMetadata(providerEventType, item),
      delta_mode: delta.mode,
    });
    return sessionRes.success ? success({}) : failure(sessionRes.error);
  }

  private emitCommandOutputDelta(
    providerEventType: ThreadEvent['type'],
    item: Extract<ThreadItem, { type: 'command_execution' }>,
  ): Result<CodexStreamEventEffect> {
    const state = getItemState(this.itemStates, item);
    const delta = buildDelta(state.output, item.aggregated_output);
    state.output = item.aggregated_output;
    if (!delta) return success({});
    state.wroteOutput = true;
    const sessionRes = this.recordSession('stdout', 'output', delta.content, {
      ...baseItemMetadata(providerEventType, item),
      command: item.command,
      status: item.status,
      exit_code: item.exit_code,
      delta_mode: delta.mode,
    });
    return sessionRes.success ? success({}) : failure(sessionRes.error);
  }

  private emitTodoSnapshot(
    providerEventType: ThreadEvent['type'],
    item: Extract<ThreadItem, { type: 'todo_list' }>,
  ): Result<CodexStreamEventEffect> {
    const state = getItemState(this.itemStates, item);
    const snapshot = formatTodoList(item);
    if (snapshot === state.todoSnapshot) return success({});
    state.todoSnapshot = snapshot;
    const sessionRes = this.recordSession('tool', 'message', snapshot, {
      ...baseItemMetadata(providerEventType, item),
      delta_mode: 'snapshot',
    });
    return sessionRes.success ? success({}) : failure(sessionRes.error);
  }

  private emitToolSnapshot(
    providerEventType: ThreadEvent['type'],
    item: Extract<ThreadItem, { type: 'mcp_tool_call' | 'file_change' }>,
  ): Result<CodexStreamEventEffect> {
    const state = getItemState(this.itemStates, item);
    const snapshot = buildToolSnapshot(item);
    if (snapshot === state.toolSnapshot) return success({});
    state.toolSnapshot = snapshot;
    const status = getItemStatus(item);
    const content =
      item.type === 'mcp_tool_call'
        ? `${item.server}/${item.tool} 状态：${status || 'unknown'}`
        : `文件变更状态：${status || 'unknown'}\n${formatFileChanges(item)}`;
    const sessionRes = this.recordSession('tool', 'progress', content, {
      ...baseItemMetadata(providerEventType, item),
      status,
      delta_mode: 'snapshot',
    });
    return sessionRes.success ? success({}) : failure(sessionRes.error);
  }

  private recordSession(
    source: TaskAgentSessionEventSource,
    kind: TaskAgentSessionEventKind,
    content: string,
    metadata: Record<string, unknown>,
  ): Result<void> {
    if (!content.trim()) return success(undefined);
    const truncated = truncateContent(content, metadata);
    const eventRes = recordTaskAgentSessionEvent({
      ...this.context,
      source,
      kind,
      content: truncated.content,
      metadata: truncated.metadata,
    });
    return eventRes.success ? success(undefined) : failure(eventRes.error);
  }
}
