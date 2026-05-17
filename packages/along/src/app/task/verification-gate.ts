import type { Result } from '../../core/result';
import type { TaskWorktreeCommandRunner } from '../worktree';

export interface VerificationCommand {
  name: string;
  command: string;
  args: string[];
}

export interface VerificationStepResult {
  name: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

export interface VerificationGateInput {
  worktreePath: string;
  commandRunner: TaskWorktreeCommandRunner;
  commands: VerificationCommand[];
  timeoutMs?: number;
}

export interface VerificationGateOutput {
  passed: boolean;
  results: VerificationStepResult[];
  summary: string;
}

const DEFAULT_TIMEOUT_MS = 300_000;
const OUTPUT_TRUNCATE_LIMIT = 6000;

function truncateOutput(output: string): string {
  if (output.length <= OUTPUT_TRUNCATE_LIMIT) return output;
  return `${output.slice(0, OUTPUT_TRUNCATE_LIMIT)}\n...（输出已截断）`;
}

async function runStep(
  input: VerificationGateInput,
  step: VerificationCommand,
): Promise<VerificationStepResult> {
  const start = Date.now();
  const result: Result<string> = await input.commandRunner(
    step.command,
    step.args,
    { cwd: input.worktreePath },
  );
  const durationMs = Date.now() - start;
  const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (durationMs > timeout) {
    return {
      name: step.name,
      passed: false,
      output: `命令超时（${durationMs}ms > ${timeout}ms）`,
      durationMs,
    };
  }
  return {
    name: step.name,
    passed: result.success,
    output: truncateOutput(result.success ? result.data : result.error),
    durationMs,
  };
}

function buildSummary(results: VerificationStepResult[]): string {
  const lines = results.map(
    (r) => `- ${r.name}: ${r.passed ? '✓' : '✗'} (${r.durationMs}ms)`,
  );
  const failed = results.filter((r) => !r.passed);
  if (failed.length === 0) return ['验证通过', '', ...lines].join('\n');
  return [
    `验证失败：${failed.map((f) => f.name).join(', ')}`,
    '',
    ...lines,
    '',
    ...failed.map((f) => [`### ${f.name} 失败输出`, '', f.output].join('\n')),
  ].join('\n');
}

export async function runVerificationGate(
  input: VerificationGateInput,
): Promise<VerificationGateOutput> {
  const results: VerificationStepResult[] = [];
  for (const step of input.commands) {
    const result = await runStep(input, step);
    results.push(result);
    if (!result.passed) {
      return { passed: false, results, summary: buildSummary(results) };
    }
  }
  return { passed: true, results, summary: buildSummary(results) };
}

export const DEFAULT_VERIFICATION_COMMANDS: VerificationCommand[] = [
  { name: 'lint', command: 'bunx', args: ['biome', 'check', '.'] },
  { name: 'typecheck', command: 'bunx', args: ['tsc', '--noEmit'] },
  { name: 'test', command: 'bun', args: ['run', 'test'] },
  { name: 'build', command: 'bun', args: ['run', 'build'] },
];

const DEFAULT_MAX_FIX_ATTEMPTS = 2;

export interface ProductionContract {
  version: number;
  verify: {
    commands: VerificationCommand[];
    maxFixAttempts: number;
    timeoutMs: number;
  };
}

export const DEFAULT_PRODUCTION_CONTRACT: ProductionContract = {
  version: 1,
  verify: {
    commands: DEFAULT_VERIFICATION_COMMANDS,
    maxFixAttempts: DEFAULT_MAX_FIX_ATTEMPTS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
};

export function loadProductionContract(
  worktreePath: string,
  defaultBranch: string,
  commandRunner: TaskWorktreeCommandRunner,
): Promise<ProductionContract> {
  return loadContractFromDefaultBranch(
    worktreePath,
    defaultBranch,
    commandRunner,
  );
}

async function loadContractFromDefaultBranch(
  worktreePath: string,
  defaultBranch: string,
  commandRunner: TaskWorktreeCommandRunner,
): Promise<ProductionContract> {
  const result = await commandRunner(
    'git',
    ['show', `origin/${defaultBranch}:.along/production-contract.json`],
    { cwd: worktreePath },
  );
  if (!result.success) return DEFAULT_PRODUCTION_CONTRACT;
  try {
    const parsed = JSON.parse(result.data) as Partial<ProductionContract>;
    if (parsed.verify?.commands) return parsed as ProductionContract;
    return DEFAULT_PRODUCTION_CONTRACT;
  } catch {
    return DEFAULT_PRODUCTION_CONTRACT;
  }
}
