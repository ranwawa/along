import { consola } from 'consola';
import { getErrorMessage } from '../core/common';
import { runTaskChatAgent } from '../domain/task-chat-agent';
import { runTaskDelivery } from '../domain/task-delivery';
import { runTaskExecAgent } from '../domain/task-exec-agent';
import { routeTaskMessage } from '../domain/task-message-router';
import {
  readTaskPlanningSnapshot,
  TASK_RUNTIME_EXECUTION_MODE,
} from '../domain/task-planning';
import { runTaskPlanningAgent } from '../domain/task-planning-agent';
import { runTaskTitleSummary } from '../domain/task-title-summary';
import type {
  ScheduledTaskDeliveryRun,
  ScheduledTaskExecRun,
  ScheduledTaskPlanningRun,
  ScheduledTaskTitleSummaryRun,
} from '../integration/task-api';
import {
  continueAutonomousTaskAfterExec,
  continueAutonomousTaskAfterPlanning,
} from '../integration/task-autonomous-continuation';

const logger = consola.withTag('webhook-server');

const DEFAULT_MAX_CONCURRENT_AGENTS = 3;
const MAX_CONCURRENT_AGENTS = Number(
  process.env.ALONG_MAX_CONCURRENT_AGENTS ||
    String(DEFAULT_MAX_CONCURRENT_AGENTS),
);

export let runningAgents = 0;
export const agentQueue: Array<{ label: string; fn: () => Promise<unknown> }> =
  [];
export const taskLocks = new Map<string, Promise<void>>();

export function runAgent(label: string, fn: () => Promise<unknown>) {
  runningAgents++;
  logger.info(
    `[并发限制] ${label} 开始执行（${runningAgents}/${MAX_CONCURRENT_AGENTS}）`,
  );
  fn()
    .catch((error) => {
      logger.error(`[并发限制] ${label} 执行异常: ${getErrorMessage(error)}`);
    })
    .finally(() => {
      runningAgents--;
      logger.info(
        `[并发限制] ${label} 执行完毕（${runningAgents}/${MAX_CONCURRENT_AGENTS}，队列 ${agentQueue.length} 个）`,
      );
      const next = agentQueue.shift();
      if (next) runAgent(next.label, next.fn);
    });
}

export function enqueueAgent(label: string, fn: () => Promise<unknown>) {
  if (runningAgents < MAX_CONCURRENT_AGENTS) {
    runAgent(label, fn);
    return;
  }
  logger.info(
    `[并发限制] ${label} 已排队（当前 ${runningAgents}/${MAX_CONCURRENT_AGENTS} 运行中，队列 ${agentQueue.length} 个）`,
  );
  agentQueue.push({ label, fn });
}

export function withTaskLock(
  taskId: string,
  fn: () => Promise<void>,
): Promise<void> {
  const previous = taskLocks.get(taskId) || Promise.resolve();
  const next = previous.then(fn, fn);
  taskLocks.set(taskId, next);
  next.finally(() => {
    if (taskLocks.get(taskId) === next) taskLocks.delete(taskId);
  });
  return next;
}

function isTaskAgentCancellationError(error: string): boolean {
  return error.includes('已取消') || error.includes('已中断');
}

async function resolveRoute(
  input: ScheduledTaskPlanningRun,
): Promise<'chat' | 'planning'> {
  const mode = input.runtimeExecutionMode;
  if (mode === TASK_RUNTIME_EXECUTION_MODE.CHAT) return 'chat';
  if (mode === TASK_RUNTIME_EXECUTION_MODE.PLAN) return 'planning';
  if (mode === TASK_RUNTIME_EXECUTION_MODE.EXEC) return 'planning';
  if (mode !== TASK_RUNTIME_EXECUTION_MODE.AUTO && mode !== undefined)
    return 'planning';
  if (input.reason !== 'user_message') return 'planning';

  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success || !snapshotRes.data) return 'planning';
  const snapshot = snapshotRes.data;

  if (snapshot.currentPlan) return 'planning';

  const lastArtifact = snapshot.artifacts[snapshot.artifacts.length - 1];
  if (!lastArtifact || lastArtifact.type !== 'user_message') return 'planning';

  const routeRes = await routeTaskMessage({
    messageBody: lastArtifact.body,
    taskTitle: snapshot.task.title || '',
    hasApprovedPlan: Boolean(
      snapshot.currentPlan && snapshot.thread.status === 'approved',
    ),
  });

  if (!routeRes.success) {
    logger.warn(
      `[Task ${input.taskId}] router 失败，回退到 planning: ${routeRes.error}`,
    );
    return 'planning';
  }

  return routeRes.data.intent === 'chat' ? 'chat' : 'planning';
}

async function runChatBranch(input: ScheduledTaskPlanningRun): Promise<void> {
  logger.info(`[Task ${input.taskId}] router → chat`);
  const chatResult = await runTaskChatAgent({
    taskId: input.taskId,
    cwd: input.cwd,
    agentId: input.agentId,
    modelId: input.modelId,
    personalityVersion: input.personalityVersion,
  });
  if (!chatResult.success) {
    if (isTaskAgentCancellationError(chatResult.error)) {
      logger.info(`[Task ${input.taskId}] chat 已中断`);
      return;
    }
    logger.error(`[Task ${input.taskId}] chat 失败: ${chatResult.error}`);
  }
}

async function runPlanningBranch(
  input: ScheduledTaskPlanningRun,
): Promise<void> {
  logger.info(`[Task ${input.taskId}] planning 开始: ${input.reason}`);
  const result = await runTaskPlanningAgent(input);
  if (!result.success) {
    if (isTaskAgentCancellationError(result.error)) {
      logger.info(`[Task ${input.taskId}] planning 已中断`);
      return;
    }
    logger.error(`[Task ${input.taskId}] planning 失败: ${result.error}`);
    return;
  }
  logger.info(`[Task ${input.taskId}] planning 完成: ${result.data.action}`);
  const continuation = continueAutonomousTaskAfterPlanning({
    taskId: input.taskId,
    cwd: input.cwd,
    plannerAction: result.data.action,
    scheduleExec: enqueueTaskExecRun,
  });
  if (!continuation.success) {
    logger.error(
      `[Task ${input.taskId}] autonomous planning 推进失败: ${continuation.error}`,
    );
  }
}

export function enqueueTaskPlanningRun(input: ScheduledTaskPlanningRun) {
  enqueueAgent(`Task ${input.taskId} planning`, async () => {
    await withTaskLock(input.taskId, async () => {
      const route = await resolveRoute(input);
      if (route === 'chat') {
        await runChatBranch(input);
      } else {
        await runPlanningBranch(input);
      }
    });
  });
}

export function enqueueTaskExecRun(input: ScheduledTaskExecRun) {
  enqueueAgent(`Task ${input.taskId} exec`, async () => {
    await withTaskLock(input.taskId, async () => {
      logger.info(`[Task ${input.taskId}] exec 开始: ${input.reason}`);
      const result = await runTaskExecAgent(input);
      if (!result.success) {
        if (isTaskAgentCancellationError(result.error)) {
          logger.info(`[Task ${input.taskId}] exec 已中断`);
          return;
        }
        logger.error(`[Task ${input.taskId}] exec 失败: ${result.error}`);
        return;
      }
      logger.info(`[Task ${input.taskId}] exec 完成`);
      const continuation = continueAutonomousTaskAfterExec({
        taskId: input.taskId,
        cwd: input.cwd,
        scheduleExec: enqueueTaskExecRun,
        scheduleDelivery: enqueueTaskDeliveryRun,
      });
      if (!continuation.success) {
        logger.error(
          `[Task ${input.taskId}] autonomous exec 推进失败: ${continuation.error}`,
        );
      }
    });
  });
}

export function enqueueTaskDeliveryRun(input: ScheduledTaskDeliveryRun) {
  enqueueAgent(`Task ${input.taskId} delivery`, async () => {
    await withTaskLock(input.taskId, async () => {
      logger.info(`[Task ${input.taskId}] delivery 开始: ${input.reason}`);
      const result = await runTaskDelivery(input);
      if (!result.success) {
        logger.error(`[Task ${input.taskId}] delivery 失败: ${result.error}`);
        return;
      }
      logger.info(`[Task ${input.taskId}] delivery 完成: ${result.data.prUrl}`);
    });
  });
}

export function runScheduledTaskTitleSummary(
  input: ScheduledTaskTitleSummaryRun,
) {
  void runTaskTitleSummary(input).then((result) => {
    if (!result.success) {
      logger.warn(`[Task ${input.taskId}] 标题自动总结失败: ${result.error}`);
    }
  });
}
