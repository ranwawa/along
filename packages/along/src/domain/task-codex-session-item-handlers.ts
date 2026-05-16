import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk';
import type { Result } from '../core/result';
import { success } from '../core/result';
import {
  baseItemMetadata,
  type CmdItem,
  cmdCompletedMeta,
  cmdCompletedMsg,
  cmdMeta,
  emitCompletionTextIfNeeded,
  emitTextDelta,
  emitTodoSnapshot,
  type FileItem,
  fileCompletedMsg,
  fileMeta,
  formatFileChanges,
  type ItemStreamState,
  type McpItem,
  mcpCompletedMeta,
  mcpCompletedMsg,
  mcpMeta,
  type RecordFn,
  type ToolThreadItem,
  type WebItem,
  webMeta,
} from './task-codex-session-event-helpers';

type Effect = { latestThreadId?: string };

function toEffect(result: Result<void>): Result<Effect> {
  return result.success ? success({}) : { success: false, error: result.error };
}

export function handleItemStarted(
  states: Map<string, ItemStreamState>,
  record: RecordFn,
  t: ThreadEvent['type'],
  item: ThreadItem,
): Result<Effect> {
  switch (item.type) {
    case 'agent_message':
    case 'reasoning':
      return item.text ? emitTextDelta(states, record, t, item) : success({});
    case 'todo_list':
      return emitTodoSnapshot(states, record, t, item);
    case 'error':
      return toEffect(
        record('system', 'error', item.message, baseItemMetadata(t, item)),
      );
    default:
      return handleToolItemStarted(record, t, item as ToolThreadItem);
  }
}

function handleToolItemStarted(
  record: RecordFn,
  t: ThreadEvent['type'],
  item: ToolThreadItem,
): Result<Effect> {
  switch (item.type) {
    case 'command_execution': {
      const msg = `开始执行命令：\n${item.command}`;
      return toEffect(record('tool', 'progress', msg, cmdMeta(t, item)));
    }
    case 'mcp_tool_call': {
      const msg = `开始调用工具：${item.server}/${item.tool}`;
      return toEffect(record('tool', 'progress', msg, mcpMeta(t, item)));
    }
    case 'web_search':
      return toEffect(
        record('tool', 'progress', `开始搜索：${item.query}`, webMeta(t, item)),
      );
    case 'file_change': {
      const msg = `文件变更开始处理。\n${formatFileChanges(item)}`;
      return toEffect(record('tool', 'progress', msg, fileMeta(t, item)));
    }
  }
}

export function handleItemCompleted(
  states: Map<string, ItemStreamState>,
  record: RecordFn,
  t: ThreadEvent['type'],
  item: ThreadItem,
): Result<Effect> {
  switch (item.type) {
    case 'agent_message':
    case 'reasoning':
      return emitCompletionTextIfNeeded(states, record, t, item);
    case 'todo_list':
      return emitTodoSnapshot(states, record, t, item);
    case 'error':
      return toEffect(
        record('system', 'error', item.message, baseItemMetadata(t, item)),
      );
    default:
      return handleToolItemCompleted(record, t, item as ToolThreadItem);
  }
}

function handleToolItemCompleted(
  record: RecordFn,
  t: ThreadEvent['type'],
  item: ToolThreadItem,
): Result<Effect> {
  switch (item.type) {
    case 'command_execution': {
      const i = item as CmdItem;
      return completedToolRecord(
        record,
        i,
        cmdCompletedMsg(i),
        cmdCompletedMeta(t, i),
      );
    }
    case 'file_change': {
      const i = item as FileItem;
      return completedToolRecord(
        record,
        i,
        fileCompletedMsg(i),
        fileMeta(t, i),
      );
    }
    case 'mcp_tool_call': {
      const i = item as McpItem;
      return completedToolRecord(
        record,
        i,
        mcpCompletedMsg(i),
        mcpCompletedMeta(t, i),
      );
    }
    case 'web_search': {
      const msg = `搜索完成：${item.query}`;
      return toEffect(
        record('tool', 'message', msg, webMeta(t, item as WebItem)),
      );
    }
  }
}

function completedToolRecord(
  record: RecordFn,
  item: { status?: string },
  message: string,
  meta: Record<string, unknown>,
): Result<Effect> {
  const f = item.status === 'failed';
  return toEffect(
    record(f ? 'stderr' : 'tool', f ? 'error' : 'message', message, meta),
  );
}
