import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
const agentConfigMocks = vi.hoisted(() => ({
  getProviderConfig: vi.fn(),
}));
const planningMocks = vi.hoisted(() => ({
  updatePlanningTaskTitle: vi.fn(),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn().mockImplementation(function ChatOpenAIMock() {
    return {
      invoke: invokeMock,
    };
  }),
}));

vi.mock('../integration/agent-config', () => ({
  getProviderConfig: agentConfigMocks.getProviderConfig,
}));

vi.mock('./task-planning', () => ({
  updatePlanningTaskTitle: planningMocks.updatePlanningTaskTitle,
}));

import { generateTaskTitle, runTaskTitleSummary } from './task-title-summary';

describe('task-title-summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DEEPSEEK_API_KEY;
    agentConfigMocks.getProviderConfig.mockReturnValue({
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      token: 'sk-test',
      models: ['deepseek-v4-flash'],
    });
    invokeMock.mockResolvedValue({ content: 'Provider 配置管理' });
    planningMocks.updatePlanningTaskTitle.mockReturnValue({
      success: true,
      data: null,
    });
  });

  it('使用 DeepSeek V4 Flash 根据内容生成标题', async () => {
    const result = await generateTaskTitle('实现 provider token 管理界面');

    expect(result).toEqual({ success: true, data: 'Provider 配置管理' });
    expect(invokeMock).toHaveBeenCalledWith([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: '实现 provider token 管理界面' },
    ]);
  });

  it('无 token 时返回失败并交给创建流程使用 15 字符回退', async () => {
    agentConfigMocks.getProviderConfig.mockReturnValue({
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      models: ['deepseek-v4-flash'],
    });

    const result = await generateTaskTitle('没有 token 时不应调用模型');

    expect(result.success).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('生成成功后更新 Task 标题', async () => {
    const result = await runTaskTitleSummary({
      taskId: 'task-1',
      body: '根据内容总结标题',
    });

    expect(result.success).toBe(true);
    expect(planningMocks.updatePlanningTaskTitle).toHaveBeenCalledWith({
      taskId: 'task-1',
      title: 'Provider 配置管理',
    });
  });
});
