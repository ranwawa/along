import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk';
import type { Result } from '../../../core/result';
import { failure, success } from '../../../core/result';
import {
  recordTaskAgentProgress,
  recordTaskAgentSessionEvent,
  TASK_AGENT_PROGRESS_PHASE,
  type TaskAgentSessionEventKind,
  type TaskAgentSessionEventSource,
} from '../../planning';
import type { TaskAgentProgressContext } from '../../task/agent-progress';
import {
  baseItemMetadata,
  emitCommandOutputDelta,
  emitTextDelta,
  emitTodoSnapshot,
  emitToolSnapshot,
  getErrorMessage,
  getItemState,
  type ItemStreamState,
  type RecordFn,
  truncateContent,
} from './session-event-helpers';
import {
  handleItemCompleted,
  handleItemStarted,
} from './session-item-handlers';

interface CodexStreamEventEffect {
  latestThreadId?: string;
}

export class CodexStreamSessionEventMapper {
  private readonly itemStates = new Map<string, ItemStreamState>();

  constructor(private readonly context: TaskAgentProgressContext) {}

  handleEvent(event: ThreadEvent): Result<CodexStreamEventEffect> {
    switch (event.type) {
      case 'thread.started': {
        const res = this.record('system', 'message', 'Codex thread 已连接。', {
          provider_event_type: event.type,
          thread_id: event.thread_id,
        });
        return res.success
          ? success({ latestThreadId: event.thread_id })
          : failure(res.error);
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
        return this.recordError(
          `Codex turn 失败：${getErrorMessage(event.error.message)}`,
          { provider_event_type: event.type, error: event.error.message },
        );
      case 'error':
        return this.recordError(
          `Codex stream 错误：${getErrorMessage(event.message)}`,
          { provider_event_type: event.type, error: event.message },
        );
    }
  }

  private recordError(
    message: string,
    metadata: Record<string, unknown>,
  ): Result<CodexStreamEventEffect> {
    return this.toEffect(this.record('system', 'error', message, metadata));
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
    const res = this.record(
      'system',
      'progress',
      'Codex 已开始处理本轮请求。',
      {
        provider_event_type: providerEventType,
      },
    );
    return res.success ? success({}) : failure(res.error);
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
    const res = this.record('system', 'message', 'Codex turn 已完成。', {
      provider_event_type: event.type,
      usage: event.usage,
    });
    return res.success ? success({}) : failure(res.error);
  }

  private handleItemEvent(
    providerEventType: Extract<
      ThreadEvent['type'],
      'item.started' | 'item.updated' | 'item.completed'
    >,
    item: ThreadItem,
  ): Result<CodexStreamEventEffect> {
    const r = this.recordFn();
    if (providerEventType === 'item.started') {
      getItemState(this.itemStates, item);
      return handleItemStarted(this.itemStates, r, providerEventType, item);
    }
    if (providerEventType === 'item.updated')
      return this.handleItemUpdated(providerEventType, item);
    return handleItemCompleted(this.itemStates, r, providerEventType, item);
  }

  private handleItemUpdated(
    t: ThreadEvent['type'],
    item: ThreadItem,
  ): Result<CodexStreamEventEffect> {
    const r = this.recordFn();
    switch (item.type) {
      case 'agent_message':
      case 'reasoning':
        return emitTextDelta(this.itemStates, r, t, item);
      case 'command_execution':
        return emitCommandOutputDelta(this.itemStates, r, t, item);
      case 'todo_list':
        return emitTodoSnapshot(this.itemStates, r, t, item);
      case 'mcp_tool_call':
      case 'file_change':
        return emitToolSnapshot(this.itemStates, r, t, item);
      case 'web_search':
        return success({});
      case 'error':
        return this.toEffect(
          r('system', 'error', item.message, { ...baseItemMetadata(t, item) }),
        );
    }
  }

  private recordFn(): RecordFn {
    return (source, kind, content, metadata) =>
      this.record(source, kind, content, metadata);
  }

  private record(
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
