import type { TaskDisplayState } from '../types';
import { getTaskDisplayStatusStyle } from './statusStyles';

export function getTaskDisplayClass(state: TaskDisplayState): string {
  return getTaskDisplayStatusStyle(state).badgeClass;
}
