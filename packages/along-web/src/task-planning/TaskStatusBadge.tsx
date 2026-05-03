import type { TaskPlanningSnapshot } from '../types';
import { getTaskStatusClass, getTaskStatusLabel } from './format';

export function TaskStatusBadge({
  snapshot,
}: {
  snapshot: TaskPlanningSnapshot;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${getTaskStatusClass(
        snapshot.task.status,
      )}`}
    >
      {getTaskStatusLabel(snapshot.task.status)}
    </span>
  );
}
