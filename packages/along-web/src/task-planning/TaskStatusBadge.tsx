import type { TaskPlanningSnapshot } from '../types';
import { getTaskDisplayClass } from './displayFormat';
import { getTaskStatusClass, getTaskStatusLabel } from './format';

export function TaskStatusBadge({
  snapshot,
}: {
  snapshot: TaskPlanningSnapshot;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${
        snapshot.display
          ? getTaskDisplayClass(snapshot.display.state)
          : getTaskStatusClass(snapshot.task.status)
      }`}
    >
      {snapshot.display?.label || getTaskStatusLabel(snapshot.task.status)}
    </span>
  );
}
