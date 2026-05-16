import type { ThreadEvent, ThreadItem, Usage } from '@openai/codex-sdk';
import type { TaskAgentProgressContext } from './task-agent-progress';
import { registerTaskAgentCancellation } from './task-agent-run-lifecycle';
import type { TaskCodexInputItem, TaskCodexThread } from './task-codex-runner';
import { CodexStreamSessionEventMapper } from './task-codex-session-events';
import { formatDuration, readCodexTurnTimeoutMs } from './task-codex-utils';

export interface RunCodexPromptResult {
  turn: {
    finalResponse: string;
    items: ThreadItem[];
    usage: Usage | null;
  };
  latestThreadId?: string;
}

function isRecoverableCodexStreamError(message: string): boolean {
  return /^Reconnecting\.\.\. \d+\/\d+\b/.test(message);
}

export async function runCodexPrompt(
  runId: string,
  context: TaskAgentProgressContext,
  thread: TaskCodexThread,
  prompt: string | TaskCodexInputItem[],
  outputSchema: unknown,
  onThreadStarted: (threadId: string) => void,
): Promise<RunCodexPromptResult> {
  const timeoutMs = readCodexTurnTimeoutMs();
  const abortController = new AbortController();
  const unregisterCancel = registerTaskAgentCancellation(runId, (reason) =>
    abortController.abort(reason),
  );
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);
  try {
    const stream = await thread.runStreamed(prompt, {
      outputSchema,
      signal: abortController.signal,
    });
    return await consumeCodexStream(context, stream.events, onThreadStarted);
  } catch (error: unknown) {
    if (!timedOut) throw error;
    throw new Error(
      `Codex Agent 执行超时（超过 ${formatDuration(timeoutMs)}）`,
      { cause: error },
    );
  } finally {
    unregisterCancel();
    clearTimeout(timeout);
  }
}

async function consumeCodexStream(
  context: TaskAgentProgressContext,
  events: AsyncGenerator<ThreadEvent>,
  onThreadStarted: (threadId: string) => void,
): Promise<RunCodexPromptResult> {
  const mapper = new CodexStreamSessionEventMapper(context);
  const items: ThreadItem[] = [];
  let finalResponse = '';
  let usage: Usage | null = null;
  let latestThreadId: string | undefined;
  let lastRecoverableError: string | undefined;

  for await (const event of events) {
    const eventRes = mapper.handleEvent(event);
    if (!eventRes.success) throw new Error(eventRes.error);
    if (eventRes.data.latestThreadId) {
      latestThreadId = eventRes.data.latestThreadId;
      onThreadStarted(latestThreadId);
    }
    if (event.type === 'item.completed') {
      items.push(event.item);
      if (event.item.type === 'agent_message') finalResponse = event.item.text;
    } else if (event.type === 'turn.completed') {
      usage = event.usage;
      lastRecoverableError = undefined;
    } else if (event.type === 'turn.failed') {
      throw new Error(event.error.message);
    } else if (event.type === 'error') {
      if (isRecoverableCodexStreamError(event.message)) {
        lastRecoverableError = event.message;
        continue;
      }
      throw new Error(event.message);
    }
  }

  if (lastRecoverableError) throw new Error(lastRecoverableError);
  return { turn: { finalResponse, items, usage }, latestThreadId };
}
