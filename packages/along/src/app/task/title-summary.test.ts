import { beforeEach, describe, expect, it, vi } from 'vitest';

const planningMocks = vi.hoisted(() => ({
  updatePlanningTaskTitle: vi.fn(),
}));

vi.mock('../planning', () => ({
  updatePlanningTaskTitle: planningMocks.updatePlanningTaskTitle,
}));

import { generateTaskTitle, runTaskTitleSummary } from './title-summary';

describe('task-title-summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    planningMocks.updatePlanningTaskTitle.mockReturnValue({
      success: true,
      data: null,
    });
  });

  it('根据内容前 20 个字符生成标题', async () => {
    const result = await generateTaskTitle(
      '实现 Codex 单一路径配置和运行路径清理',
    );

    expect(result).toEqual({
      success: true,
      data: '实现 Codex 单一路径配置和运行路径',
    });
  });

  it('生成成功后更新 Task 标题', async () => {
    const result = await runTaskTitleSummary({
      taskId: 'task-1',
      body: '根据内容总结标题',
    });

    expect(result.success).toBe(true);
    expect(planningMocks.updatePlanningTaskTitle).toHaveBeenCalledWith({
      taskId: 'task-1',
      title: '根据内容总结标题',
    });
  });
});
