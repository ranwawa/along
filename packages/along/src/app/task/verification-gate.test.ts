import { describe, expect, it } from 'vitest';
import type { Result } from '../../core/result';
import type { TaskWorktreeCommandRunner } from '../worktree';
import {
  DEFAULT_PRODUCTION_CONTRACT,
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

describe('DEFAULT_PRODUCTION_CONTRACT', () => {
  it('包含 lint/typecheck/test/build 四个默认命令', () => {
    const commands = DEFAULT_PRODUCTION_CONTRACT.verify.commands;
    expect(commands).toHaveLength(4);
    expect(commands.map((c) => c.name)).toEqual([
      'lint',
      'typecheck',
      'test',
      'build',
    ]);
  });

  it('默认最大修复次数为 2', () => {
    expect(DEFAULT_PRODUCTION_CONTRACT.verify.maxFixAttempts).toBe(2);
  });
});
