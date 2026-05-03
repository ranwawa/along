import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import { runTaskAgentTurn } from './task-agent-runtime';
import {
  PLAN_STATUS,
  readTaskPlanningSnapshot,
  TASK_STATUS,
  type TaskPlanningSnapshot,
  type TaskPlanRevisionRecord,
  updateTaskStatus,
} from './task-planning';
import {
  prepareTaskWorktree,
  type TaskWorktreeCommandRunner,
} from './task-worktree';

export interface RunTaskImplementationAgentInput {
  taskId: string;
  agentId?: string;
  cwd: string;
  editor?: string;
  model?: string;
  personalityVersion?: string;
  commandRunner?: TaskWorktreeCommandRunner;
  readDefaultBranch?: (repoPath: string) => Promise<Result<string>>;
}

export interface RunTaskImplementationAgentOutput {
  snapshot: TaskPlanningSnapshot;
  approvedPlan: TaskPlanRevisionRecord;
  assistantText: string;
}

function truncateText(value: string, maxLength = 5000): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...（内容已截断）`;
}

function findApprovedPlan(
  snapshot: TaskPlanningSnapshot,
): TaskPlanRevisionRecord | null {
  if (!snapshot.thread.approvedPlanId) return null;
  return (
    snapshot.plans.find(
      (plan) =>
        plan.planId === snapshot.thread.approvedPlanId &&
        plan.status === PLAN_STATUS.APPROVED,
    ) || null
  );
}

function buildImplementationPrompt(
  snapshot: TaskPlanningSnapshot,
  approvedPlan: TaskPlanRevisionRecord,
  worktreePath: string,
): string {
  const context = {
    task: {
      taskId: snapshot.task.taskId,
      title: snapshot.task.title,
      body: truncateText(snapshot.task.body, 4000),
      repoOwner: snapshot.task.repoOwner,
      repoName: snapshot.task.repoName,
      sourceCwd: snapshot.task.cwd,
      worktreePath,
    },
    approvedPlan: {
      planId: approvedPlan.planId,
      version: approvedPlan.version,
      body: truncateText(approvedPlan.body, 8000),
    },
    recentArtifacts: snapshot.artifacts.slice(-30).map((artifact) => ({
      artifactId: artifact.artifactId,
      type: artifact.type,
      role: artifact.role,
      body: truncateText(artifact.body, 2500),
      metadata: artifact.metadata,
    })),
  };

  return [
    '你是 Along 的 Implementation Agent。你的任务是在当前 Task 专属 worktree 中严格按已批准方案完成代码实现。',
    '',
    '要求：',
    '1. 不重新制定计划，不扩大需求范围。',
    '2. 修改代码前先检查当前 worktree 状态和相关代码。',
    '3. 只修改完成已批准方案所必需的文件。',
    '4. 需要测试时，优先运行相关的局部测试或类型检查。',
    '5. 不要创建 PR，不要提交或推送代码；本阶段只完成工作区代码改动和必要验证。',
    '6. 最终回复必须简短说明改了什么、验证了什么、还有什么风险。',
    '',
    '任务上下文：',
    JSON.stringify(context, null, 2),
  ].join('\n');
}

export async function runTaskImplementationAgent(
  input: RunTaskImplementationAgentInput,
): Promise<Result<RunTaskImplementationAgentOutput>> {
  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${input.taskId}`);

  const approvedPlan = findApprovedPlan(snapshot);
  if (!approvedPlan) return failure('当前 Task 没有已批准方案，不能开始实现');
  if (
    snapshot.task.status !== TASK_STATUS.PLANNING_APPROVED &&
    snapshot.task.status !== TASK_STATUS.IMPLEMENTING
  ) {
    return failure(`当前 Task 状态不能开始实现: ${snapshot.task.status}`);
  }

  const worktreeRes = await prepareTaskWorktree({
    snapshot,
    repoPath: input.cwd,
    commandRunner: input.commandRunner,
    readDefaultBranch: input.readDefaultBranch,
  });
  if (!worktreeRes.success) return worktreeRes;

  const startedRes = updateTaskStatus(input.taskId, TASK_STATUS.IMPLEMENTING);
  if (!startedRes.success) return startedRes;

  const agentId = input.agentId || 'implementer';
  const result = await runTaskAgentTurn({
    taskId: input.taskId,
    threadId: snapshot.thread.threadId,
    agentId,
    prompt: buildImplementationPrompt(
      snapshot,
      approvedPlan,
      worktreeRes.data.worktreePath,
    ),
    cwd: worktreeRes.data.worktreePath,
    editor: input.editor,
    model: input.model,
    personalityVersion: input.personalityVersion,
    inputArtifactIds: [
      approvedPlan.artifactId,
      ...snapshot.artifacts.map((artifact) => artifact.artifactId),
    ],
    options: {
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 80,
    },
  });

  if (!result.success) {
    const rollbackRes = updateTaskStatus(
      input.taskId,
      TASK_STATUS.PLANNING_APPROVED,
    );
    return rollbackRes.success ? result : rollbackRes;
  }

  const doneRes = updateTaskStatus(input.taskId, TASK_STATUS.IMPLEMENTED);
  if (!doneRes.success) return doneRes;

  const refreshedSnapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!refreshedSnapshotRes.success) return refreshedSnapshotRes;
  if (!refreshedSnapshotRes.data) {
    return failure(`Task ${input.taskId} 已实现，但读取快照失败`);
  }

  return success({
    snapshot: refreshedSnapshotRes.data,
    approvedPlan,
    assistantText: result.data.assistantText,
  });
}
