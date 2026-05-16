import { buildVerificationFixPrompt } from '../agents/task-verify';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import { runTaskAgentTurn } from './task-agent-runtime';
import { runTaskAutoCommit } from './task-auto-commit';
import type {
  RunTaskExecAgentInput,
  RunTaskExecAgentOutput,
} from './task-exec-agent';
import {
  readTaskPlanningSnapshot,
  recordTaskAgentResult,
  type TaskPlanningSnapshot,
  type TaskPlanRevisionRecord,
  transitionTaskWorkflow,
} from './task-planning';
import {
  loadProductionContract,
  runVerificationGate,
  type VerificationGateOutput,
} from './task-verification-gate';
import type {
  PrepareTaskWorktreeOutput,
  TaskWorktreeCommandRunner,
} from './task-worktree';

export interface RunVerificationLoopInput {
  taskInput: RunTaskExecAgentInput;
  snapshot: TaskPlanningSnapshot;
  approvedPlan: TaskPlanRevisionRecord;
  worktree: PrepareTaskWorktreeOutput;
  agentId: string;
  commandRunner: TaskWorktreeCommandRunner;
  assistantText: string;
  commitShas: string[];
}

function recordVerificationResult(
  input: RunVerificationLoopInput,
  output: VerificationGateOutput,
  attempt: number,
  maxAttempts: number,
) {
  recordTaskAgentResult({
    taskId: input.taskInput.taskId,
    threadId: input.snapshot.thread.threadId,
    agentId: 'verifier',
    runtimeId: 'system',
    body: [
      `验证${output.passed ? '通过' : '失败'}（第 ${attempt}/${maxAttempts + 1} 次）`,
      '',
      output.summary,
    ].join('\n'),
    metadata: { kind: 'verification_report', passed: output.passed, attempt },
  });
}

async function runFixTurn(
  input: RunVerificationLoopInput,
  gateOutput: VerificationGateOutput,
  attempt: number,
  maxAttempts: number,
) {
  return runTaskAgentTurn({
    taskId: input.taskInput.taskId,
    threadId: input.snapshot.thread.threadId,
    agentId: input.agentId,
    prompt: buildVerificationFixPrompt({
      snapshot: input.snapshot,
      approvedPlan: input.approvedPlan,
      worktreePath: input.worktree.worktreePath,
      verificationSummary: gateOutput.summary,
      failedSteps: gateOutput.results.filter((r) => !r.passed),
      attempt,
      maxAttempts,
    }),
    cwd: input.worktree.worktreePath,
    modelId: input.taskInput.modelId,
    personalityVersion: input.taskInput.personalityVersion,
    codexOptions: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
    },
  });
}

async function recommit(
  input: RunVerificationLoopInput,
): Promise<Result<string[]>> {
  const snapshotRes = readTaskPlanningSnapshot(input.taskInput.taskId);
  if (!snapshotRes.success) return snapshotRes;
  if (!snapshotRes.data) return failure('读取快照失败');

  const commitRes = await runTaskAutoCommit({
    snapshot: snapshotRes.data,
    worktreePath: input.worktree.worktreePath,
    branchName: input.worktree.branchName,
    defaultBranch: input.worktree.defaultBranch,
    commandRunner: input.commandRunner,
  });
  if (!commitRes.success) return failure(commitRes.error);
  return success(commitRes.data.commitShas);
}

function completeVerification(
  input: RunVerificationLoopInput,
): Result<RunTaskExecAgentOutput> {
  const verifiedRes = transitionTaskWorkflow({
    taskId: input.taskInput.taskId,
    event: { type: 'exec.verified' },
  });
  if (!verifiedRes.success) return failure(verifiedRes.error);
  return success({
    snapshot: input.snapshot,
    approvedPlan: input.approvedPlan,
    assistantText: input.assistantText,
    commitShas: input.commitShas,
  });
}

async function attemptFix(
  input: RunVerificationLoopInput,
  gateOutput: VerificationGateOutput,
  attempt: number,
  maxAttempts: number,
): Promise<boolean> {
  const fixRes = await runFixTurn(input, gateOutput, attempt, maxAttempts);
  if (!fixRes.success) return false;
  const commitRes = await recommit(input);
  if (!commitRes.success) return false;
  input.commitShas = commitRes.data;
  return true;
}

export async function runVerificationLoop(
  input: RunVerificationLoopInput,
): Promise<Result<RunTaskExecAgentOutput>> {
  const contract = await loadProductionContract(
    input.worktree.worktreePath,
    input.worktree.defaultBranch,
    input.commandRunner,
  );
  const maxFixAttempts = contract.verify.maxFixAttempts;

  for (let attempt = 0; attempt <= maxFixAttempts; attempt += 1) {
    const gateOutput = await runVerificationGate({
      worktreePath: input.worktree.worktreePath,
      commandRunner: input.commandRunner,
      commands: contract.verify.commands,
      timeoutMs: contract.verify.timeoutMs,
    });
    recordVerificationResult(input, gateOutput, attempt, maxFixAttempts);

    if (gateOutput.passed) return completeVerification(input);
    if (attempt === maxFixAttempts) break;
    const fixed = await attemptFix(
      input,
      gateOutput,
      attempt + 1,
      maxFixAttempts,
    );
    if (!fixed) break;
  }

  transitionTaskWorkflow({
    taskId: input.taskInput.taskId,
    event: { type: 'task.failed' },
  });
  return failure('验证失败，已超过最大修复次数');
}
