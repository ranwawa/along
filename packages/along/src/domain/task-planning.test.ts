import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, string | number | null>;

const mockDbState = vi.hoisted(() => {
  type State = {
    tasks: Row[];
    threads: Row[];
    artifacts: Row[];
    plans: Row[];
    rounds: Row[];
    bindings: Row[];
    runs: Row[];
  };

  const state: State = {
    tasks: [],
    threads: [],
    artifacts: [],
    plans: [],
    rounds: [],
    bindings: [],
    runs: [],
  };

  function reset() {
    state.tasks = [];
    state.threads = [];
    state.artifacts = [];
    state.plans = [];
    state.rounds = [];
    state.bindings = [];
    state.runs = [];
  }

  function normalizeSql(sql: string): string {
    return sql.replace(/\s+/g, ' ').trim();
  }

  function findTask(taskId: string): Row | undefined {
    return state.tasks.find((row) => row.task_id === taskId);
  }

  function findThread(threadId: string): Row | undefined {
    return state.threads.find((row) => row.thread_id === threadId);
  }

  function activeThread(taskId: string): Row | null {
    const task = findTask(taskId);
    return task?.active_thread_id
      ? findThread(String(task.active_thread_id)) || null
      : null;
  }

  function makeStmt(sql: string) {
    const normalized = normalizeSql(sql);
    return {
      get: (...args: Array<string | number | null>) => {
        if (normalized.includes('FROM task_threads tt JOIN task_items')) {
          return activeThread(String(args[0]));
        }
        if (normalized === 'SELECT * FROM task_items WHERE task_id = ?') {
          return findTask(String(args[0])) || null;
        }
        if (
          normalized ===
          'SELECT * FROM task_threads WHERE thread_id = ? AND task_id = ?'
        ) {
          return (
            state.threads.find(
              (row) => row.thread_id === args[0] && row.task_id === args[1],
            ) || null
          );
        }
        if (normalized.includes('FROM task_plan_revisions WHERE plan_id = ?')) {
          return (
            state.plans.find(
              (row) => row.plan_id === args[0] && row.thread_id === args[1],
            ) || null
          );
        }
        if (
          normalized.includes('FROM task_feedback_rounds WHERE round_id = ?')
        ) {
          return (
            state.rounds.find(
              (row) => row.round_id === args[0] && row.thread_id === args[1],
            ) || null
          );
        }
        if (normalized.includes('FROM task_agent_bindings')) {
          return (
            state.bindings.find(
              (row) =>
                row.thread_id === args[0] &&
                row.agent_id === args[1] &&
                row.provider === args[2],
            ) || null
          );
        }
        if (normalized === 'SELECT * FROM task_agent_runs WHERE run_id = ?') {
          return state.runs.find((row) => row.run_id === args[0]) || null;
        }
        return null;
      },
      all: (...args: Array<string | number | null>) => {
        if (
          normalized ===
          'SELECT task_id FROM task_items ORDER BY updated_at DESC LIMIT ?'
        ) {
          return [...state.tasks]
            .sort((a, b) =>
              String(b.updated_at).localeCompare(String(a.updated_at)),
            )
            .slice(0, Number(args[0]))
            .map((row) => ({ task_id: row.task_id }));
        }
        if (normalized.includes('FROM task_artifacts WHERE thread_id = ?')) {
          return state.artifacts.filter((row) => row.thread_id === args[0]);
        }
        if (
          normalized.includes('FROM task_plan_revisions WHERE thread_id = ?')
        ) {
          return state.plans
            .filter((row) => row.thread_id === args[0])
            .sort((a, b) => Number(a.version) - Number(b.version));
        }
        return [];
      },
      run: (...args: Array<string | number | null>) => {
        if (normalized.startsWith('INSERT INTO task_items')) {
          const [
            taskId,
            title,
            body,
            source,
            status,
            activeThreadId,
            createdAt,
            updatedAt,
          ] = args;
          state.tasks.push({
            task_id: taskId,
            title,
            body,
            source,
            status,
            active_thread_id: activeThreadId,
            created_at: createdAt,
            updated_at: updatedAt,
          });
          return { changes: 1 };
        }

        if (normalized.startsWith('INSERT INTO task_threads')) {
          const [threadId, taskId, purpose, status, createdAt, updatedAt] =
            args;
          state.threads.push({
            thread_id: threadId,
            task_id: taskId,
            purpose,
            status,
            current_plan_id: null,
            open_round_id: null,
            approved_plan_id: null,
            created_at: createdAt,
            updated_at: updatedAt,
          });
          return { changes: 1 };
        }

        if (normalized.startsWith('INSERT INTO task_artifacts')) {
          const [
            artifactId,
            taskId,
            threadId,
            type,
            role,
            body,
            metadata,
            createdAt,
          ] = args;
          state.artifacts.push({
            artifact_id: artifactId,
            task_id: taskId,
            thread_id: threadId,
            type,
            role,
            body,
            metadata,
            created_at: createdAt,
          });
          return { changes: 1 };
        }

        if (
          normalized ===
          'UPDATE task_threads SET updated_at = ? WHERE thread_id = ?'
        ) {
          const [updatedAt, threadId] = args;
          const row = findThread(String(threadId));
          if (row) row.updated_at = updatedAt;
          return { changes: row ? 1 : 0 };
        }

        if (
          normalized ===
          'UPDATE task_items SET updated_at = ? WHERE task_id = ?'
        ) {
          const [updatedAt, taskId] = args;
          const row = findTask(String(taskId));
          if (row) row.updated_at = updatedAt;
          return { changes: row ? 1 : 0 };
        }

        if (normalized.startsWith('INSERT INTO task_feedback_rounds')) {
          const [
            roundId,
            taskId,
            threadId,
            basedOnPlanId,
            feedbackArtifactIds,
            status,
            createdAt,
          ] = args;
          state.rounds.push({
            round_id: roundId,
            task_id: taskId,
            thread_id: threadId,
            based_on_plan_id: basedOnPlanId,
            feedback_artifact_ids: feedbackArtifactIds,
            status,
            resolution: null,
            produced_plan_id: null,
            created_at: createdAt,
            resolved_at: null,
          });
          return { changes: 1 };
        }

        if (
          normalized.includes(
            'UPDATE task_threads SET status = ?, open_round_id = ?, updated_at = ?',
          )
        ) {
          const [status, roundId, updatedAt, threadId] = args;
          const row = findThread(String(threadId));
          if (row) {
            row.status = status;
            row.open_round_id = roundId;
            row.updated_at = updatedAt;
          }
          return { changes: row ? 1 : 0 };
        }

        if (
          normalized.includes(
            'UPDATE task_feedback_rounds SET feedback_artifact_ids = ?, status = ?',
          )
        ) {
          const [ids, status, roundId] = args;
          const row = state.rounds.find((item) => item.round_id === roundId);
          if (row) {
            row.feedback_artifact_ids = ids;
            row.status = status;
          }
          return { changes: row ? 1 : 0 };
        }

        if (
          normalized.includes(
            'UPDATE task_threads SET status = ?, updated_at = ?',
          )
        ) {
          const [status, updatedAt, threadId] = args;
          const row = findThread(String(threadId));
          if (row) {
            row.status = status;
            row.updated_at = updatedAt;
          }
          return { changes: row ? 1 : 0 };
        }

        if (
          normalized.includes(
            'UPDATE task_plan_revisions SET status = ? WHERE thread_id = ?',
          )
        ) {
          const [status, threadId, fromStatus] = args;
          for (const row of state.plans) {
            if (row.thread_id === threadId && row.status === fromStatus) {
              row.status = status;
            }
          }
          return { changes: 1 };
        }

        if (normalized.startsWith('INSERT INTO task_plan_revisions')) {
          const [
            planId,
            taskId,
            threadId,
            version,
            basedOnPlanId,
            status,
            artifactId,
            body,
            createdAt,
          ] = args;
          state.plans.push({
            plan_id: planId,
            task_id: taskId,
            thread_id: threadId,
            version,
            based_on_plan_id: basedOnPlanId,
            status,
            artifact_id: artifactId,
            body,
            created_at: createdAt,
          });
          return { changes: 1 };
        }

        if (
          normalized.includes(
            'UPDATE task_feedback_rounds SET status = ?, resolution = ?, produced_plan_id = ?, resolved_at = ?',
          )
        ) {
          const [status, resolution, producedPlanId, resolvedAt, roundId] =
            args;
          const row = state.rounds.find((item) => item.round_id === roundId);
          if (row) {
            row.status = status;
            row.resolution = resolution;
            row.produced_plan_id = producedPlanId;
            row.resolved_at = resolvedAt;
          }
          return { changes: row ? 1 : 0 };
        }

        if (
          normalized.includes(
            'UPDATE task_threads SET status = ?, current_plan_id = ?, open_round_id = NULL',
          )
        ) {
          const [status, planId, updatedAt, threadId] = args;
          const row = findThread(String(threadId));
          if (row) {
            row.status = status;
            row.current_plan_id = planId;
            row.open_round_id = null;
            row.updated_at = updatedAt;
          }
          return { changes: row ? 1 : 0 };
        }

        if (
          normalized.includes(
            'UPDATE task_feedback_rounds SET status = ?, resolution = ?, resolved_at = ?',
          )
        ) {
          const [status, resolution, resolvedAt, roundId] = args;
          const row = state.rounds.find((item) => item.round_id === roundId);
          if (row) {
            row.status = status;
            row.resolution = resolution;
            row.resolved_at = resolvedAt;
          }
          return { changes: row ? 1 : 0 };
        }

        if (
          normalized.includes(
            'UPDATE task_threads SET status = ?, open_round_id = NULL',
          )
        ) {
          const [status, updatedAt, threadId] = args;
          const row = findThread(String(threadId));
          if (row) {
            row.status = status;
            row.open_round_id = null;
            row.updated_at = updatedAt;
          }
          return { changes: row ? 1 : 0 };
        }

        if (
          normalized ===
          'UPDATE task_plan_revisions SET status = ? WHERE plan_id = ?'
        ) {
          const [status, planId] = args;
          const row = state.plans.find((item) => item.plan_id === planId);
          if (row) row.status = status;
          return { changes: row ? 1 : 0 };
        }

        if (
          normalized.includes(
            'UPDATE task_threads SET status = ?, approved_plan_id = ?, updated_at = ?',
          )
        ) {
          const [status, planId, updatedAt, threadId] = args;
          const row = findThread(String(threadId));
          if (row) {
            row.status = status;
            row.approved_plan_id = planId;
            row.updated_at = updatedAt;
          }
          return { changes: row ? 1 : 0 };
        }

        if (
          normalized.includes(
            'UPDATE task_items SET status = ?, updated_at = ?',
          )
        ) {
          const [status, updatedAt, taskId] = args;
          const row = findTask(String(taskId));
          if (row) {
            row.status = status;
            row.updated_at = updatedAt;
          }
          return { changes: row ? 1 : 0 };
        }

        if (normalized.startsWith('INSERT INTO task_agent_bindings')) {
          const [
            threadId,
            agentId,
            provider,
            cwd,
            model,
            personalityVersion,
            updatedAt,
          ] = args;
          state.bindings.push({
            thread_id: threadId,
            agent_id: agentId,
            provider,
            provider_session_id: null,
            cwd,
            model,
            personality_version: personalityVersion,
            updated_at: updatedAt,
          });
          return { changes: 1 };
        }

        if (normalized.includes('UPDATE task_agent_bindings SET cwd =')) {
          const [
            cwd,
            model,
            personalityVersion,
            updatedAt,
            threadId,
            agentId,
            provider,
          ] = args;
          const row = state.bindings.find(
            (item) =>
              item.thread_id === threadId &&
              item.agent_id === agentId &&
              item.provider === provider,
          );
          if (row) {
            row.cwd = cwd || row.cwd;
            row.model = model || row.model;
            row.personality_version =
              personalityVersion || row.personality_version;
            row.updated_at = updatedAt;
          }
          return { changes: row ? 1 : 0 };
        }

        if (
          normalized.includes(
            'UPDATE task_agent_bindings SET provider_session_id = ?',
          )
        ) {
          const [sessionId, updatedAt, threadId, agentId, provider] = args;
          const row = state.bindings.find(
            (item) =>
              item.thread_id === threadId &&
              item.agent_id === agentId &&
              item.provider === provider,
          );
          if (row) {
            row.provider_session_id = sessionId;
            row.updated_at = updatedAt;
          }
          return { changes: row ? 1 : 0 };
        }

        if (normalized.startsWith('INSERT INTO task_agent_runs')) {
          const [
            runId,
            taskId,
            threadId,
            agentId,
            provider,
            sessionAtStart,
            status,
            inputIds,
            startedAt,
          ] = args;
          state.runs.push({
            run_id: runId,
            task_id: taskId,
            thread_id: threadId,
            agent_id: agentId,
            provider,
            provider_session_id_at_start: sessionAtStart,
            provider_session_id_at_end: null,
            status,
            input_artifact_ids: inputIds,
            output_artifact_ids: '[]',
            error: null,
            started_at: startedAt,
            ended_at: null,
          });
          return { changes: 1 };
        }

        if (normalized.startsWith('UPDATE task_agent_runs SET status = ?')) {
          const [status, endSessionId, outputIds, error, endedAt, runId] = args;
          const row = state.runs.find((item) => item.run_id === runId);
          if (row) {
            row.status = status;
            row.provider_session_id_at_end = endSessionId;
            row.output_artifact_ids = outputIds;
            row.error = error;
            row.ended_at = endedAt;
          }
          return { changes: row ? 1 : 0 };
        }

        return { changes: 0 };
      },
    };
  }

  return {
    reset,
    db: {
      prepare: makeStmt,
      transaction: (fn: () => void) => fn,
    },
  };
});

vi.mock('../core/db', () => ({
  getDb: () => ({ success: true, data: mockDbState.db }),
}));

import {
  AGENT_RUN_STATUS,
  approveCurrentTaskPlan,
  createPlanningTask,
  createTaskAgentRun,
  ensureTaskAgentBinding,
  finishTaskAgentRun,
  listTaskPlanningSnapshots,
  PLAN_STATUS,
  publishPlanningUpdate,
  publishTaskPlanRevision,
  readTaskPlanningSnapshot,
  recordTaskAgentResult,
  submitTaskMessage,
  TASK_STATUS,
  THREAD_STATUS,
  updateTaskAgentProviderSession,
} from './task-planning';

function createTaskWithPlan() {
  const created = createPlanningTask({
    title: '设计本地 Task planning',
    body: '不依赖 GitHub Issue 完成 planning。',
    source: 'test',
  });
  expect(created.success).toBe(true);
  if (!created.success) throw new Error(created.error);

  const plan = publishTaskPlanRevision({
    taskId: created.data.task.taskId,
    body: '## Plan v1\n\n先建立 Task/Thread/Artifact。',
  });
  expect(plan.success).toBe(true);
  if (!plan.success) throw new Error(plan.error);

  return { taskId: created.data.task.taskId, plan: plan.data };
}

describe('task-planning', () => {
  beforeEach(() => {
    mockDbState.reset();
  });

  it('当创建任务并发布首版计划时，期望进入等待审批状态', () => {
    const { taskId, plan } = createTaskWithPlan();

    expect(plan.version).toBe(1);
    expect(plan.status).toBe(PLAN_STATUS.ACTIVE);

    const snapshot = readTaskPlanningSnapshot(taskId);
    expect(snapshot.success).toBe(true);
    if (!snapshot.success || !snapshot.data)
      throw new Error('missing snapshot');

    expect(snapshot.data.thread.status).toBe(THREAD_STATUS.AWAITING_APPROVAL);
    expect(snapshot.data.currentPlan?.planId).toBe(plan.planId);
    expect(snapshot.data.artifacts.map((item) => item.type)).toEqual([
      'user_message',
      'plan_revision',
    ]);
  });

  it('当首版计划前需要澄清时，期望记录 Planning Update 并保持可继续讨论', () => {
    const created = createPlanningTask({
      title: '实现 Task API',
      body: '希望通过网页创建 planning task。',
      source: 'test',
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);

    const update = publishPlanningUpdate({
      taskId: created.data.task.taskId,
      body: '需要先确认默认执行仓库。',
      kind: 'clarification_request',
    });
    expect(update.success).toBe(true);
    if (!update.success) throw new Error(update.error);

    const snapshot = readTaskPlanningSnapshot(created.data.task.taskId);
    expect(snapshot.success).toBe(true);
    if (!snapshot.success || !snapshot.data)
      throw new Error('missing snapshot');
    expect(snapshot.data.currentPlan).toBeNull();
    expect(snapshot.data.openRound).toBeNull();
    expect(snapshot.data.thread.status).toBe(THREAD_STATUS.DISCUSSING);
    expect(snapshot.data.artifacts.map((item) => item.type)).toEqual([
      'user_message',
      'planning_update',
    ]);
  });

  it('当存在未处理反馈时，期望禁止批准当前计划', () => {
    const { taskId } = createTaskWithPlan();

    const feedback = submitTaskMessage({
      taskId,
      body: '这个方案需要说明为什么不直接复用 GitHub Issue。',
    });
    expect(feedback.success).toBe(true);
    if (!feedback.success) throw new Error(feedback.error);
    expect(feedback.data.round?.status).toBe('open');

    const approve = approveCurrentTaskPlan(taskId);
    expect(approve.success).toBe(false);
  });

  it('当反馈只需要解释时，期望发布 Planning Update 后可批准原计划', () => {
    const { taskId, plan } = createTaskWithPlan();
    const feedback = submitTaskMessage({
      taskId,
      body: '这个方案为什么不算自建 Linear？',
    });
    expect(feedback.success).toBe(true);

    const update = publishPlanningUpdate({
      taskId,
      body: '这是执行运行时，不处理项目管理和优先级。',
    });
    expect(update.success).toBe(true);

    const approve = approveCurrentTaskPlan(taskId);
    expect(approve.success).toBe(true);
    if (!approve.success) throw new Error(approve.error);
    expect(approve.data.planId).toBe(plan.planId);
    expect(approve.data.status).toBe(PLAN_STATUS.APPROVED);

    const snapshot = readTaskPlanningSnapshot(taskId);
    expect(snapshot.success).toBe(true);
    if (!snapshot.success || !snapshot.data)
      throw new Error('missing snapshot');
    expect(snapshot.data.task.status).toBe(TASK_STATUS.PLANNING_APPROVED);
    expect(snapshot.data.thread.status).toBe(THREAD_STATUS.APPROVED);
  });

  it('当反馈改变执行约束时，期望生成新版计划并批准新版计划', () => {
    const { taskId, plan } = createTaskWithPlan();
    const feedback = submitTaskMessage({
      taskId,
      body: '需要明确 Claude session resume 不是事实源。',
    });
    expect(feedback.success).toBe(true);

    const revised = publishTaskPlanRevision({
      taskId,
      body: '## Plan v2\n\n新增 provider session 只是优化项的约束。',
    });
    expect(revised.success).toBe(true);
    if (!revised.success) throw new Error(revised.error);

    expect(revised.data.version).toBe(2);
    expect(revised.data.basedOnPlanId).toBe(plan.planId);

    const approve = approveCurrentTaskPlan(taskId);
    expect(approve.success).toBe(true);
    if (!approve.success) throw new Error(approve.error);
    expect(approve.data.planId).toBe(revised.data.planId);

    const snapshot = readTaskPlanningSnapshot(taskId);
    expect(snapshot.success).toBe(true);
    if (!snapshot.success || !snapshot.data)
      throw new Error('missing snapshot');
    expect(snapshot.data.plans.map((item) => item.status)).toEqual([
      PLAN_STATUS.SUPERSEDED,
      PLAN_STATUS.APPROVED,
    ]);
  });

  it('当更新 Agent Binding 时，期望下次读取到同一个 provider session', () => {
    const { taskId } = createTaskWithPlan();
    const snapshot = readTaskPlanningSnapshot(taskId);
    expect(snapshot.success).toBe(true);
    if (!snapshot.success || !snapshot.data)
      throw new Error('missing snapshot');

    const binding = ensureTaskAgentBinding({
      threadId: snapshot.data.thread.threadId,
      agentId: 'planner',
      provider: 'claude',
      cwd: '/tmp/project',
    });
    expect(binding.success).toBe(true);
    if (!binding.success) throw new Error(binding.error);
    expect(binding.data.providerSessionId).toBeUndefined();

    const update = updateTaskAgentProviderSession(
      snapshot.data.thread.threadId,
      'planner',
      'claude',
      'session-1',
    );
    expect(update.success).toBe(true);

    const nextBinding = ensureTaskAgentBinding({
      threadId: snapshot.data.thread.threadId,
      agentId: 'planner',
      provider: 'claude',
    });
    expect(nextBinding.success).toBe(true);
    if (!nextBinding.success) throw new Error(nextBinding.error);
    expect(nextBinding.data.providerSessionId).toBe('session-1');
  });

  it('当记录 Agent Run 时，期望能保存开始和结束的 provider session', () => {
    const { taskId } = createTaskWithPlan();
    const snapshot = readTaskPlanningSnapshot(taskId);
    expect(snapshot.success).toBe(true);
    if (!snapshot.success || !snapshot.data)
      throw new Error('missing snapshot');

    const run = createTaskAgentRun({
      taskId,
      threadId: snapshot.data.thread.threadId,
      agentId: 'planner',
      provider: 'claude',
      providerSessionIdAtStart: 'session-1',
      inputArtifactIds: ['art-1'],
    });
    expect(run.success).toBe(true);
    if (!run.success) throw new Error(run.error);
    expect(run.data.status).toBe(AGENT_RUN_STATUS.RUNNING);

    const finished = finishTaskAgentRun({
      runId: run.data.runId,
      status: AGENT_RUN_STATUS.SUCCEEDED,
      providerSessionIdAtEnd: 'session-2',
      outputArtifactIds: ['art-2'],
    });
    expect(finished.success).toBe(true);
    if (!finished.success) throw new Error(finished.error);
    expect(finished.data.providerSessionIdAtStart).toBe('session-1');
    expect(finished.data.providerSessionIdAtEnd).toBe('session-2');
    expect(finished.data.outputArtifactIds).toEqual(['art-2']);
  });

  it('当记录 Agent 原始输出时，期望保存为 agent_result artifact', () => {
    const { taskId } = createTaskWithPlan();
    const snapshot = readTaskPlanningSnapshot(taskId);
    expect(snapshot.success).toBe(true);
    if (!snapshot.success || !snapshot.data)
      throw new Error('missing snapshot');

    const result = recordTaskAgentResult({
      taskId,
      threadId: snapshot.data.thread.threadId,
      agentId: 'planner',
      provider: 'claude',
      runId: 'run-1',
      body: '{"action":"plan_revision","body":"Plan"}',
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.type).toBe('agent_result');
    expect(result.data.metadata.runId).toBe('run-1');
  });

  it('当列出 Task Planning 快照时，期望返回最近任务', () => {
    const first = createPlanningTask({
      title: '第一个任务',
      body: '先创建一个 planning task。',
      source: 'test',
    });
    expect(first.success).toBe(true);
    const second = createPlanningTask({
      title: '第二个任务',
      body: '再创建一个 planning task。',
      source: 'test',
    });
    expect(second.success).toBe(true);

    const list = listTaskPlanningSnapshots(10);
    expect(list.success).toBe(true);
    if (!list.success) throw new Error(list.error);
    expect(list.data).toHaveLength(2);
    expect(list.data.map((item) => item.task.title)).toEqual(
      expect.arrayContaining(['第一个任务', '第二个任务']),
    );
  });
});
