import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../core/config', () => ({
  config: {
    CONFIG_FILE: '/mock/.along/config.json',
  },
}));

vi.mock('../core/result', () => ({
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
}));

vi.mock('consola', () => ({
  consola: {
    withTag: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

const mockFs = {
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
};
vi.mock('fs', () => ({ default: mockFs }));

// 每次 import 都需要 fresh module 因为有 cachedConfig 状态
let agentConfig: typeof import('../integration/agent-config');

describe('agent-config.ts', () => {
  const originalEnv = process.env;

  beforeEach(async () => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.ALONG_AGENT_ROLE;

    // 由于 cachedConfig 是模块级变量，需要每次重新导入
    vi.resetModules();
    agentConfig = await import('../integration/agent-config');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getAgentRole()', () => {
    it('环境变量 ALONG_AGENT_ROLE 优先', () => {
      process.env.ALONG_AGENT_ROLE = 'bot-alice';
      expect(agentConfig.getAgentRole()).toBe('bot-alice');
    });

    it('无环境变量时从配置文件读取 defaultAgent', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ defaultAgent: 'bot-bob' }),
      );

      expect(agentConfig.getAgentRole()).toBe('bot-bob');
    });

    it('无配置时返回 null', () => {
      mockFs.existsSync.mockReturnValue(false);
      expect(agentConfig.getAgentRole()).toBeNull();
    });
  });

  describe('getAgentToken()', () => {
    it('从配置文件读取指定角色的 token', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          agents: {
            'bot-alice': { name: 'Alice', githubToken: 'ghp_alice123' },
          },
        }),
      );

      expect(agentConfig.getAgentToken('bot-alice')).toBe('ghp_alice123');
    });

    it('角色不存在时返回 null', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ agents: {} }));

      expect(agentConfig.getAgentToken('nonexistent')).toBeNull();
    });

    it('配置文件不存在时返回 null', () => {
      mockFs.existsSync.mockReturnValue(false);
      expect(agentConfig.getAgentToken('any')).toBeNull();
    });
  });

  describe('getAgentName()', () => {
    it('返回角色显示名称', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          agents: {
            'bot-alice': { name: 'Alice Bot', githubToken: 'xxx' },
          },
        }),
      );

      expect(agentConfig.getAgentName('bot-alice')).toBe('Alice Bot');
    });
  });

  describe('resolveAgentToken()', () => {
    it('有角色且有 token 时返回 token', () => {
      process.env.ALONG_AGENT_ROLE = 'bot-alice';
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          agents: {
            'bot-alice': { name: 'Alice', githubToken: 'ghp_resolved' },
          },
        }),
      );

      expect(agentConfig.resolveAgentToken()).toBe('ghp_resolved');
    });

    it('无角色时返回 null', () => {
      delete process.env.ALONG_AGENT_ROLE;
      mockFs.existsSync.mockReturnValue(false);

      expect(agentConfig.resolveAgentToken()).toBeNull();
    });

    it('有角色但无 token 时返回 null', () => {
      process.env.ALONG_AGENT_ROLE = 'bot-alice';
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ agents: {} }));

      expect(agentConfig.resolveAgentToken()).toBeNull();
    });
  });
});
