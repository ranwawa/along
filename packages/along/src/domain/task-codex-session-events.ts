import type { TaskAgentProgressContext } from './task-agent-progress';
import { writeTaskAgentSessionEvent } from './task-agent-progress';
import type { TaskCodexTurn } from './task-codex-runner';

export function writeCodexTurnSessionEvents(
  context: TaskAgentProgressContext,
  turn: TaskCodexTurn,
) {
  if (turn.finalResponse.trim()) {
    writeTaskAgentSessionEvent(context, 'agent', 'output', turn.finalResponse, {
      type: 'final_response',
    });
  }
  if (turn.items.length > 0) {
    writeTaskAgentSessionEvent(
      context,
      'tool',
      'message',
      `Codex 返回 ${turn.items.length} 条会话 item。`,
      { type: 'items', count: turn.items.length },
    );
  }
}
