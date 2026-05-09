import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getAgentRole,
  getWebhookSecret,
  getWorkspaces,
  resolveAgentToken,
} from './agent-config';

describe('agent-config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('从环境变量读取 agent role', () => {
    process.env.ALONG_AGENT_ROLE = 'planner';
    expect(getAgentRole()).toBe('planner');
  });

  it('从环境变量读取 GitHub token', () => {
    process.env.ALONG_GITHUB_TOKEN = 'ghp_secret';
    expect(resolveAgentToken()).toBe('ghp_secret');
  });

  it('从环境变量读取 webhook secret', () => {
    process.env.ALONG_WEBHOOK_SECRET = 'secret';
    expect(getWebhookSecret()).toBe('secret');
  });

  it('从环境变量读取 workspace 列表', () => {
    process.env.ALONG_WORKSPACES = '/repo/a, /repo/b';
    expect(getWorkspaces()).toEqual(['/repo/a', '/repo/b']);
  });
});
