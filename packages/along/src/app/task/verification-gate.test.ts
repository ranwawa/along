import { describe, expect, it } from 'vitest';
import type { Result } from '../../core/result';
import type { TaskWorktreeCommandRunner } from '../worktree';
import {
  loadProductionContract,
  runVerificationGate,
  type VerificationCommand,
} from './verification-gate';

function createRunner(
  results: Record<string, Result<string>>,
): TaskWorktreeCommandRunner {
  return async (command, args, _options) => {
    const key = `${command} ${args.join(' ')}`;
    return results[key] ?? { success: true, data: '' };
  };
}

const COMMANDS: VerificationCommand[] = [
  { name: 'lint', command: 'bunx', args: ['biome', 'check', '.'] },
  { name: 'typecheck', command: 'bunx', args: ['tsc', '--noEmit'] },
  { name: 'test', command: 'bun', args: ['run', 'test'] },
];

describe('runVerificationGate', () => {
  it('当所有步骤通过时，返回 passed=true', async () => {
    const runner = createRunner({});
    const result = await runVerificationGate({
      worktreePath: '/tmp/worktree',
      commandRunner: runner,
      commands: COMMANDS,
    });
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(result.results.every((r) => r.passed)).toBe(true);
  });

  it('当某步骤失败时，返回 passed=false 并 fail-fast', async () => {
    const runner = createRunner({
      'bunx tsc --noEmit': {
        success: false,
        error: 'error TS2322: Type mismatch',
      },
    });
    const result = await runVerificationGate({
      worktreePath: '/tmp/worktree',
      commandRunner: runner,
      commands: COMMANDS,
    });
    expect(result.passed).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].passed).toBe(true);
    expect(result.results[1].passed).toBe(false);
    expect(result.results[1].output).toContain('TS2322');
  });

  it('当命令列表为空时，返回 passed=true', async () => {
    const runner = createRunner({});
    const result = await runVerificationGate({
      worktreePath: '/tmp/worktree',
      commandRunner: runner,
      commands: [],
    });
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(0);
  });

  it('支持步骤级 cwd/env 配置', async () => {
    const calls: Array<{
      command: string;
      args: string[];
      cwd: string;
      token?: string;
    }> = [];
    const runner: TaskWorktreeCommandRunner = async (
      command,
      args,
      options,
    ) => {
      calls.push({
        command,
        args,
        cwd: options.cwd,
        token: options.env?.VERIFY_TOKEN,
      });
      return { success: true, data: '' };
    };

    const result = await runVerificationGate({
      worktreePath: '/tmp/worktree',
      commandRunner: runner,
      commands: [
        {
          name: 'web lint',
          command: 'bun',
          args: ['run', 'lint'],
          cwd: 'packages/along-web',
          env: { VERIFY_TOKEN: 'secret' },
        },
      ],
    });

    expect(result.passed).toBe(true);
    expect(calls).toEqual([
      {
        command: 'bun',
        args: ['run', 'lint'],
        cwd: '/tmp/worktree/packages/along-web',
        token: 'secret',
      },
    ]);
  });

  it('截断过长的输出', async () => {
    const longOutput = 'x'.repeat(10_000);
    const runner = createRunner({
      'bunx biome check .': { success: false, error: longOutput },
    });
    const result = await runVerificationGate({
      worktreePath: '/tmp/worktree',
      commandRunner: runner,
      commands: COMMANDS,
    });
    expect(result.results[0].output.length).toBeLessThan(7000);
    expect(result.results[0].output).toContain('截断');
  });
});

describe('loadProductionContract', () => {
  it('从默认分支读取显式生产验证契约，并补齐执行策略默认值', async () => {
    const runner = createRunner({
      'git show origin/main:.along/production-contract.json': {
        success: true,
        data: JSON.stringify({
          version: 1,
          verify: {
            setup: [
              {
                name: 'install',
                command: 'bun',
                args: ['install', '--frozen-lockfile'],
              },
            ],
            required: [
              {
                name: 'quality',
                command: 'bun',
                args: ['run', 'quality:full'],
              },
            ],
          },
        }),
      },
    });

    const result = await loadProductionContract(
      '/tmp/worktree',
      'main',
      runner,
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.verify.setup.map((step) => step.name)).toEqual([
      'install',
    ]);
    expect(result.data.verify.required.map((step) => step.name)).toEqual([
      'quality',
    ]);
    expect(result.data.verify.maxFixAttempts).toBe(2);
    expect(result.data.verify.timeoutMs).toBe(300_000);
  });

  it('缺少生产验证契约时返回失败，不提供命令默认值', async () => {
    const runner = createRunner({
      'git show origin/main:.along/production-contract.json': {
        success: false,
        error: 'path does not exist',
      },
    });

    const result = await loadProductionContract(
      '/tmp/worktree',
      'main',
      runner,
    );

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.error).toContain('缺少生产验证契约');
  });

  it('旧版 commands 配置不再被接受', async () => {
    const runner = createRunner({
      'git show origin/main:.along/production-contract.json': {
        success: true,
        data: JSON.stringify({
          version: 1,
          verify: {
            commands: [{ name: 'test', command: 'bun', args: ['run', 'test'] }],
          },
        }),
      },
    });

    const result = await loadProductionContract(
      '/tmp/worktree',
      'main',
      runner,
    );

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.error).toContain('verify.setup');
  });

  it('required 不能为空', async () => {
    const runner = createRunner({
      'git show origin/main:.along/production-contract.json': {
        success: true,
        data: JSON.stringify({
          version: 1,
          verify: {
            setup: [],
            required: [],
          },
        }),
      },
    });

    const result = await loadProductionContract(
      '/tmp/worktree',
      'main',
      runner,
    );

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.error).toContain('verify.required');
  });

  it('可选字段声明后类型不合法时返回失败', async () => {
    const runner = createRunner({
      'git show origin/main:.along/production-contract.json': {
        success: true,
        data: JSON.stringify({
          version: 1,
          verify: {
            setup: [],
            required: [
              {
                name: 'quality',
                command: 'bun',
                args: ['run', 'quality:full'],
                env: { TOKEN: 123 },
              },
            ],
          },
        }),
      },
    });

    const result = await loadProductionContract(
      '/tmp/worktree',
      'main',
      runner,
    );

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.error).toContain('env');
  });
});
