import path from 'node:path';
import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import type { TaskWorktreeCommandRunner } from '../worktree';

export interface VerificationCommand {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
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
const DEFAULT_MAX_FIX_ATTEMPTS = 2;
const PRODUCTION_CONTRACT_PATH = '.along/production-contract.json';

interface UnknownRecord {
  [key: string]: unknown;
}

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
    {
      cwd: resolveStepCwd(input.worktreePath, step.cwd),
      env: step.env ? { ...process.env, ...step.env } : process.env,
    },
  );
  const durationMs = Date.now() - start;
  const timeout = step.timeoutMs ?? input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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

function resolveStepCwd(worktreePath: string, stepCwd?: string): string {
  if (!stepCwd) return worktreePath;
  return path.isAbsolute(stepCwd) ? stepCwd : path.join(worktreePath, stepCwd);
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

export interface ProductionContract {
  version: number;
  verify: {
    setup: VerificationCommand[];
    required: VerificationCommand[];
    maxFixAttempts: number;
    timeoutMs: number;
  };
}

export function loadProductionContract(
  worktreePath: string,
  defaultBranch: string,
  commandRunner: TaskWorktreeCommandRunner,
): Promise<Result<ProductionContract>> {
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
): Promise<Result<ProductionContract>> {
  const result = await commandRunner(
    'git',
    ['show', `origin/${defaultBranch}:${PRODUCTION_CONTRACT_PATH}`],
    { cwd: worktreePath },
  );
  if (!result.success) {
    return failure(
      `缺少生产验证契约 ${PRODUCTION_CONTRACT_PATH}，不能启动执行: ${result.error}`,
    );
  }
  try {
    return normalizeProductionContract(JSON.parse(result.data));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`生产验证契约解析失败: ${message}`);
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasField(record: UnknownRecord, key: string): boolean {
  return Object.hasOwn(record, key);
}

function readString(record: UnknownRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function readStringArray(record: UnknownRecord, key: string): string[] | null {
  const value = record[key];
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === 'string') ? [...value] : null;
}

function readPositiveNumber(record: UnknownRecord, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function readStringRecord(
  record: UnknownRecord,
  key: string,
): Record<string, string> | undefined {
  const value = record[key];
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (!entries.every(([, item]) => typeof item === 'string')) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

function normalizeCommand(
  value: unknown,
  index: number,
  groupName: string,
): Result<VerificationCommand> {
  if (!isRecord(value)) {
    return failure(`${groupName}[${index}] 必须是对象`);
  }

  const name = readString(value, 'name');
  const command = readString(value, 'command');
  const args = readStringArray(value, 'args');
  if (!name) return failure(`${groupName}[${index}].name 不能为空`);
  if (!command) return failure(`${groupName}[${index}].command 不能为空`);
  if (!args) return failure(`${groupName}[${index}].args 必须是字符串数组`);

  const normalized: VerificationCommand = { name, command, args };
  if (hasField(value, 'cwd')) {
    const cwd = readString(value, 'cwd');
    if (!cwd) return failure(`${groupName}[${index}].cwd 必须是非空字符串`);
    normalized.cwd = cwd;
  }
  if (hasField(value, 'env')) {
    const env = readStringRecord(value, 'env');
    if (!env) return failure(`${groupName}[${index}].env 必须是字符串键值对象`);
    normalized.env = env;
  }
  if (hasField(value, 'timeoutMs')) {
    const timeoutMs = readPositiveNumber(value, 'timeoutMs');
    if (!timeoutMs) {
      return failure(`${groupName}[${index}].timeoutMs 必须是正数`);
    }
    normalized.timeoutMs = timeoutMs;
  }
  return success(normalized);
}

function normalizeCommandList(
  value: unknown,
  groupName: string,
  allowEmpty: boolean,
): Result<VerificationCommand[]> {
  if (!Array.isArray(value)) return failure(`${groupName} 必须是数组`);
  if (!allowEmpty && value.length === 0) {
    return failure(`${groupName} 至少需要声明一个验证命令`);
  }

  const commands: VerificationCommand[] = [];
  for (const [index, item] of value.entries()) {
    const commandRes = normalizeCommand(item, index, groupName);
    if (!commandRes.success) return commandRes;
    commands.push(commandRes.data);
  }
  return success(commands);
}

function readPolicyNumber(
  verify: UnknownRecord,
  key: string,
  defaultValue: number,
): Result<number> {
  if (!hasField(verify, key)) return success(defaultValue);
  const value = readPositiveNumber(verify, key);
  return value ? success(value) : failure(`verify.${key} 必须是正数`);
}

function normalizeVerifyConfig(
  verify: UnknownRecord,
): Result<ProductionContract['verify']> {
  const setupRes = normalizeCommandList(verify.setup, 'verify.setup', true);
  if (!setupRes.success) return setupRes;
  const requiredRes = normalizeCommandList(
    verify.required,
    'verify.required',
    false,
  );
  if (!requiredRes.success) return requiredRes;
  const maxFixAttemptsRes = readPolicyNumber(
    verify,
    'maxFixAttempts',
    DEFAULT_MAX_FIX_ATTEMPTS,
  );
  if (!maxFixAttemptsRes.success) return maxFixAttemptsRes;
  const timeoutMsRes = readPolicyNumber(
    verify,
    'timeoutMs',
    DEFAULT_TIMEOUT_MS,
  );
  if (!timeoutMsRes.success) return timeoutMsRes;

  return success({
    setup: setupRes.data,
    required: requiredRes.data,
    maxFixAttempts: maxFixAttemptsRes.data,
    timeoutMs: timeoutMsRes.data,
  });
}

function normalizeProductionContract(
  value: unknown,
): Result<ProductionContract> {
  if (!isRecord(value)) return failure('生产验证契约必须是对象');
  if (value.version !== 1) return failure('生产验证契约 version 必须为 1');
  if (!isRecord(value.verify)) {
    return failure('生产验证契约缺少 verify 配置');
  }

  const verifyRes = normalizeVerifyConfig(value.verify);
  if (!verifyRes.success) return verifyRes;

  return success({
    version: 1,
    verify: verifyRes.data,
  });
}
