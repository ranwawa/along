import { describe, expect, it } from 'vitest';
import type { TaskFlowActionId } from '../types';
import { getFlowFlags } from './useTaskPlanningController';

function makeActionReader(enabledIds: TaskFlowActionId[]) {
  return (id: TaskFlowActionId) => enabledIds.includes(id);
}

describe('getFlowFlags', () => {
  it('当只有确认实施步骤操作可用时，期望允许触发 exec API', () => {
    expect(
      getFlowFlags(makeActionReader(['confirm_exec_steps'])).canImplement,
    ).toBe(true);
  });
});
