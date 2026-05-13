import type { TaskPlanningSnapshot } from '../types';
import { getTaskStatusLabel } from './format';
import {
  getTaskDisplayStatusStyle,
  getTaskLegacyStatusStyle,
} from './statusStyles';

const TASK_STATUS_DOT_BASE_CLASS =
  'relative inline-flex h-2.5 w-2.5 shrink-0 rounded-full ring-2';

const TASK_STATUS_DOT_RUNNING_CLASS =
  "after:absolute after:inset-0 after:rounded-full after:bg-current after:content-[''] after:animate-ping after:opacity-60 motion-reduce:after:animate-none motion-reduce:after:opacity-30";

export function TaskStatusBadge({
  snapshot,
  failed = false,
}: {
  snapshot: TaskPlanningSnapshot;
  failed?: boolean;
}) {
  const label = failed
    ? '失败'
    : snapshot.display?.label || getTaskStatusLabel(snapshot.task.status);
  const style = failed
    ? getTaskDisplayStatusStyle('failed')
    : snapshot.display
      ? getTaskDisplayStatusStyle(snapshot.display.state)
      : getTaskLegacyStatusStyle(snapshot.task.status);
  const isAgentRunning = snapshot.agentStages.some(
    (stage) => stage.status === 'running',
  );

  return (
    <span
      aria-label={label}
      className={`${TASK_STATUS_DOT_BASE_CLASS} ${style.dotClass} ${
        isAgentRunning ? TASK_STATUS_DOT_RUNNING_CLASS : ''
      }`}
      role="img"
      title={label}
    />
  );
}
