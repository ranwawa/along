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
    progress: Row[];
    sessionEvents: Row[];
  };

  const state: State = {
    tasks: [],
    threads: [],
    artifacts: [],
    plans: [],
    rounds: [],
    bindings: [],
    runs: [],
    progress: [],
    sessionEvents: [],
  };
  let legacyTaskStatusColumn = false;

  function reset() {
    state.tasks = [];
    state.threads = [];
    state.artifacts = [];
    state.plans = [];
    state.rounds = [];
    state.bindings = [];
    state.runs = [];
    state.progress = [];
    state.sessionEvents = [];
    legacyTaskStatusColumn = false;
  }

  function setLegacyTaskStatusColumn(value: boolean) {
    legacyTaskStatusColumn = value;
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
        if (normalized === 'SELECT task_id FROM task_items WHERE task_id = ?') {
          const row = findTask(String(args[0]));
          return row ? { task_id: row.task_id } : null;
        }
        if (
          normalized === 'SELECT lifecycle FROM task_items WHERE task_id = ?'
        ) {
          const row = findTask(String(args[0]));
          return row ? { lifecycle: row.lifecycle } : null;
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
                row.runtime_id === args[2],
            ) || null
          );
        }
        if (normalized === 'SELECT * FROM task_agent_runs WHERE run_id = ?') {
          return state.runs.find((row) => row.run_id === args[0]) || null;
        }
        if (
          normalized.includes('FROM task_agent_runs') &&
          normalized.includes('WHERE task_id = ? AND run_id = ? AND status = ?')
        ) {
          return (
            state.runs.find(
              (row) =>
                row.task_id === args[0] &&
                row.run_id === args[1] &&
                row.status === args[2],
            ) || null
          );
        }
        if (
          normalized.includes('FROM task_agent_runs') &&
          normalized.includes('WHERE task_id = ? AND status = ?')
        ) {
          return (
            state.runs
              .filter(
                (row) => row.task_id === args[0] && row.status === args[1],
              )
              .sort((left, right) =>
                String(right.started_at).localeCompare(String(left.started_at)),
              )[0] || null
          );
        }
        if (
          normalized.includes('SELECT runtime_session_id_at_end') &&
          normalized.includes('FROM task_agent_runs')
        ) {
          return (
            state.runs
              .filter(
                (row) =>
                  (row.thread_id === args[0] ||
                    (args[1] !== null && row.task_id === args[2])) &&
                  row.agent_id === args[3] &&
                  row.runtime_id === args[4] &&
                  row.runtime_session_id_at_end,
              )
              .sort((left, right) =>
                String(right.ended_at || right.started_at).localeCompare(
                  String(left.ended_at || left.started_at),
                ),
              )[0] || null
          );
        }
        return null;
      },
      all: (...args: Array<string | number | null>) => {
        if (normalized === 'PRAGMA table_info(task_items)') {
          return legacyTaskStatusColumn ? [{ name: 'status' }] : [];
        }
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
        if (
          normalized ===
          'SELECT task_id FROM task_items WHERE repo_owner = ? AND repo_name = ? ORDER BY updated_at DESC LIMIT ?'
        ) {
          return state.tasks
            .filter(
              (row) => row.repo_owner === args[0] && row.repo_name === args[1],
            )
            .sort((a, b) =>
              String(b.updated_at).localeCompare(String(a.updated_at)),
            )
            .slice(0, Number(args[2]))
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
        if (
          normalized.includes('FROM task_agent_bindings WHERE thread_id = ?')
        ) {
          return state.bindings.filter((row) => row.thread_id === args[0]);
        }
        if (normalized.includes('FROM task_agent_runs WHERE thread_id = ?')) {
          return state.runs
            .filter((row) => row.thread_id === args[0])
            .sort((a, b) =>
              String(a.started_at).localeCompare(String(b.started_at)),
            );
        }
        if (
          normalized.includes(
            'FROM task_agent_progress_events WHERE thread_id = ?',
          )
        ) {
          return state.progress
            .filter((row) => row.thread_id === args[0])
            .sort((a, b) =>
              String(a.created_at).localeCompare(String(b.created_at)),
            );
        }
        if (
          normalized.includes(
            'FROM task_agent_session_events WHERE thread_id = ?',
          )
        ) {
          return state.sessionEvents
            .filter((row) => row.thread_id === args[0])
            .sort((a, b) =>
              String(a.created_at).localeCompare(String(b.created_at)),
            );
        }
        if (
          normalized.includes('FROM task_agent_runs') &&
          normalized.includes('WHERE status = ?')
        ) {
          return state.runs
            .filter((row) => row.status === args[0])
            .sort((a, b) =>
              String(a.started_at).localeCompare(String(b.started_at)),
            );
        }
        return [];
      },
      run: (...args: Array<string | number | null>) => {
        if (normalized.startsWith('INSERT INTO task_items')) {
          const hasStatusColumn = normalized.includes(
            'source, status, active_thread_id',
          );
          if (legacyTaskStatusColumn && !hasStatusColumn) {
            throw new Error('NOT NULL constraint failed: task_items.status');
          }
          const [
            taskId,
            title,
            body,
            source,
            status,
            activeThreadId,
            repoOwner,
            repoName,
            cwd,
            seq,
            executionMode,
            lifecycle,
            currentWorkflowKind,
            createdAt,
            updatedAt,
          ] = hasStatusColumn
            ? args
            : [
                args[0],
                args[1],
                args[2],
                args[3],
                null,
                args[4],
                args[5],
                args[6],
                args[7],
                args[8],
                args[9],
                args[10],
                args[11],
                args[12],
                args[13],
              ];
          state.tasks.push({
            task_id: taskId,
            title,
            body,
            source,
            status,
            active_thread_id: activeThreadId,
            repo_owner: repoOwner,
            repo_name: repoName,
            cwd,
            worktree_path: null,
            branch_name: null,
            commit_shas: '[]',
            pr_url: null,
            pr_number: null,
            seq,
            type: null,
            execution_mode: executionMode,
            lifecycle,
            current_workflow_kind: currentWorkflowKind,
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

        if (
          normalized.includes(
            'UPDATE task_items SET lifecycle = ?, current_workflow_kind = ?, updated_at = ?',
          )
        ) {
          const [lifecycle, currentWorkflowKind, updatedAt, taskId] = args;
          const row = findTask(String(taskId));
          if (row) {
            row.lifecycle = lifecycle;
            row.current_workflow_kind = currentWorkflowKind;
            row.updated_at = updatedAt;
          }
          return { changes: row ? 1 : 0 };
        }

        if (
          normalized.includes(
            'UPDATE task_items SET current_workflow_kind = ?, lifecycle = ?, updated_at = ?',
          )
        ) {
          const [currentWorkflowKind, lifecycle, updatedAt, taskId] = args;
          const row = findTask(String(taskId));
          if (row) {
            row.current_workflow_kind = currentWorkflowKind;
            row.lifecycle = lifecycle;
            row.updated_at = updatedAt;
          }
          return { changes: row ? 1 : 0 };
        }

        if (
          normalized.includes(
            'UPDATE task_items SET lifecycle = ?, updated_at = ?',
          )
        ) {
          const [lifecycle, updatedAt, taskId] = args;
          const row = findTask(String(taskId));
          if (row) {
            row.lifecycle = lifecycle;
            row.updated_at = updatedAt;
          }
          return { changes: row ? 1 : 0 };
        }

        if (
          normalized.includes(
            'UPDATE task_items SET branch_name = COALESCE(?, branch_name)',
          )
        ) {
          const [
            branchName,
            worktreePath,
            commitShas,
            prUrl,
            prNumber,
            updatedAt,
            taskId,
          ] = args;
          const row = findTask(String(taskId));
          if (row) {
            row.branch_name = branchName || row.branch_name;
            row.worktree_path = worktreePath || row.worktree_path;
            row.commit_shas = commitShas || row.commit_shas;
            row.pr_url = prUrl || row.pr_url;
            row.pr_number = prNumber || row.pr_number;
            row.updated_at = updatedAt;
          }
          return { changes: row ? 1 : 0 };
        }

        if (
          normalized ===
          'UPDATE task_threads SET open_round_id = NULL, updated_at = ? WHERE thread_id = ?'
        ) {
          const [updatedAt, threadId] = args;
          const row = findThread(String(threadId));
          if (row) {
            row.open_round_id = null;
            row.updated_at = updatedAt;
          }
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
            'UPDATE task_threads SET status = ?, updated_at = ? WHERE task_id = ?',
          )
        ) {
          const [status, updatedAt, taskId] = args;
          const row = activeThread(String(taskId));
          if (row) {
            row.status = status;
            row.updated_at = updatedAt;
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
          normalized ===
          'UPDATE task_feedback_rounds SET status = ?, resolved_at = ? WHERE round_id = ?'
        ) {
          const [status, resolvedAt, roundId] = args;
          const row = state.rounds.find((item) => item.round_id === roundId);
          if (row) {
            row.status = status;
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

        if (normalized.startsWith('INSERT INTO task_agent_bindings')) {
          const [
            threadId,
            agentId,
            runtimeId,
            runtimeSessionId,
            cwd,
            model,
            personalityVersion,
            updatedAt,
          ] = args;
          state.bindings.push({
            thread_id: threadId,
            agent_id: agentId,
            runtime_id: runtimeId,
            runtime_session_id: runtimeSessionId,
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
            shouldResetRuntimeSession,
            fallbackRuntimeSession,
            updatedAt,
            threadId,
            agentId,
            runtimeId,
          ] = args;
          const row = state.bindings.find(
            (item) =>
              item.thread_id === threadId &&
              item.agent_id === agentId &&
              item.runtime_id === runtimeId,
          );
          if (row) {
            row.cwd = cwd || row.cwd;
            row.model = model || row.model;
            row.personality_version =
              personalityVersion || row.personality_version;
            if (shouldResetRuntimeSession) row.runtime_session_id = null;
            else row.runtime_session_id ||= fallbackRuntimeSession;
            row.updated_at = updatedAt;
          }
          return { changes: row ? 1 : 0 };
        }

        if (
          normalized.includes(
            'UPDATE task_agent_bindings SET runtime_session_id = ?',
          )
        ) {
          const [sessionId, updatedAt, threadId, agentId, runtimeId] = args;
          const row = state.bindings.find(
            (item) =>
              item.thread_id === threadId &&
              item.agent_id === agentId &&
              item.runtime_id === runtimeId,
          );
          if (row) {
            row.runtime_session_id = sessionId;
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
            runtimeId,
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
            runtime_id: runtimeId,
            runtime_session_id_at_start: sessionAtStart,
            runtime_session_id_at_end: null,
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
          if (normalized.includes('WHERE run_id = ? AND status = ?')) {
            const [status, outputIds, error, endedAt, runId, currentStatus] =
              args;
            const row = state.runs.find(
              (item) => item.run_id === runId && item.status === currentStatus,
            );
            if (row) {
              row.status = status;
              row.output_artifact_ids = outputIds;
              row.error = error;
              row.ended_at = endedAt;
            }
            return { changes: row ? 1 : 0 };
          }

          const [status, endSessionId, outputIds, error, endedAt, runId] = args;
          const row = state.runs.find((item) => item.run_id === runId);
          if (row) {
            row.status = status;
            row.runtime_session_id_at_end = endSessionId;
            row.output_artifact_ids = outputIds;
            row.error = error;
            row.ended_at = endedAt;
          }
          return { changes: row ? 1 : 0 };
        }

        if (normalized.startsWith('INSERT INTO task_agent_progress_events')) {
          const [
            progressId,
            runId,
            taskId,
            threadId,
            agentId,
            runtimeId,
            phase,
            summary,
            detail,
            createdAt,
          ] = args;
          state.progress.push({
            progress_id: progressId,
            run_id: runId,
            task_id: taskId,
            thread_id: threadId,
            agent_id: agentId,
            runtime_id: runtimeId,
            phase,
            summary,
            detail,
            created_at: createdAt,
          });
          return { changes: 1 };
        }

        if (normalized.startsWith('INSERT INTO task_agent_session_events')) {
          const [
            eventId,
            runId,
            taskId,
            threadId,
            agentId,
            runtimeId,
            source,
            kind,
            content,
            metadata,
            createdAt,
          ] = args;
          state.sessionEvents.push({
            event_id: eventId,
            run_id: runId,
            task_id: taskId,
            thread_id: threadId,
            agent_id: agentId,
            runtime_id: runtimeId,
            source,
            kind,
            content,
            metadata,
            created_at: createdAt,
          });
          return { changes: 1 };
        }

        return { changes: 0 };
      },
    };
  }

  return {
    reset,
    setLegacyTaskStatusColumn,
    db: {
      prepare: makeStmt,
      transaction: (fn: () => void) => fn,
    },
  };
});

vi.mock('../../core/db', () => ({
  getDb: () => ({ success: true, data: mockDbState.db }),
}));

import { success } from '../../core/result';
import {
  AGENT_RUN_STATUS,
  approveCurrentTaskPlan,
  cancelTaskAgentRun,
  closeTask,
  createPlanningTask,
  createTaskAgentRun,
  ensureTaskAgentBinding,
  finishTaskAgentRun,
  LIFECYCLE,
  listTaskPlanningSnapshots,
  PLAN_STATUS,
  publishTaskPlanRevision,
  readTaskAgentBinding,
  readTaskPlanningSnapshot,
  recordTaskAgentProgress,
  recordTaskAgentResult,
  recordTaskAgentSessionEvent,
  submitTaskMessage,
  TASK_AGENT_PROGRESS_PHASE,
  TASK_STATUS,
  type TaskStatus,
  transitionTaskWorkflow,
  updateTaskAgentRuntimeSession,
  updateTaskDelivery,
  updateTaskStatus,
} from './';

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

function moveTaskToCompatStatus(taskId: string, status: TaskStatus) {
  const transitionThrough = (
    events: Array<Parameters<typeof transitionTaskWorkflow>[0]['event']>,
  ) => {
    let result = transitionTaskWorkflow({ taskId, event: events[0] });
    if (!result.success) return result;
    for (const event of events.slice(1)) {
      result = transitionTaskWorkflow({ taskId, event });
      if (!result.success) return result;
    }
    return result;
  };

  if (status === TASK_STATUS.PLANNING) {
    return transitionThrough([{ type: 'plan.draft_completed' }]);
  }
  if (status === TASK_STATUS.IMPLEMENTING) {
    return success(undefined);
  }
  if (status === TASK_STATUS.IMPLEMENTED) {
    return transitionThrough([{ type: 'exec.completed' }]);
  }
  if (status === TASK_STATUS.DELIVERING) {
    return transitionThrough([{ type: 'exec.completed' }]);
  }
  if (status === TASK_STATUS.DELIVERED) {
    const verified = transitionThrough([
      { type: 'exec.completed' },
      { type: 'exec.verified' },
    ]);
    if (!verified.success) return verified;
    return updateTaskDelivery({
      taskId,
      prUrl: 'https://github.com/ranwawa/along/pull/1',
      prNumber: 1,
    });
  }
  if (status === TASK_STATUS.COMPLETED) {
    return transitionThrough([
      { type: 'exec.completed' },
      { type: 'exec.verified' },
      { type: 'task.accepted' },
    ]);
  }
  throw new Error(`unsupported compat status in test: ${status}`);
}

describe('task-planning', () => {
  beforeEach(() => {
    mockDbState.reset();
  });

  it('当创建 Task 未指定执行模式时，期望默认为 manual', () => {
    const created = createPlanningTask({
      title: '默认模式任务',
      body: '不指定 executionMode。',
      source: 'test',
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);

    expect(created.data.task.executionMode).toBe('manual');
  });

  it('当旧数据库仍有 status 非空列时，期望创建 Task 写入兼容状态', () => {
    mockDbState.setLegacyTaskStatusColumn(true);

    const created = createPlanningTask({
      title: '兼容旧库状态列',
      body: '旧库 task_items.status 仍然是 NOT NULL。',
      source: 'test',
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);

    expect(created.data.task.status).toBe(TASK_STATUS.PLANNING);
  });

  it('当创建 Task 指定全自动模式时，期望快照返回 autonomous', () => {
    const created = createPlanningTask({
      title: '全自动任务',
      body: '指定 executionMode。',
      source: 'test',
      executionMode: 'autonomous',
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);

    const snapshot = readTaskPlanningSnapshot(created.data.task.taskId);
    expect(snapshot.success).toBe(true);
    if (!snapshot.success || !snapshot.data)
      throw new Error('missing snapshot');
    expect(snapshot.data.task.executionMode).toBe('autonomous');
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

  it.each([
    TASK_STATUS.PLANNING,
    TASK_STATUS.IMPLEMENTING,
  ])('当 %s 状态关闭任务时，期望进入 closed 并记录关闭事件', (status) => {
    const { taskId } = createTaskWithPlan();
    if (status !== TASK_STATUS.PLANNING) {
      const approve = approveCurrentTaskPlan(taskId);
      expect(approve.success).toBe(true);
    }
    const statusRes = moveTaskToCompatStatus(taskId, status);
    expect(statusRes.success).toBe(true);

    const closed = closeTask(taskId, '无需继续');
    expect(closed.success).toBe(true);
    if (!closed.success) throw new Error(closed.error);

    expect(closed.data.task.status).toBe(TASK_STATUS.CLOSED);
    expect(closed.data.flow.currentStageId).toBe('completed');
    expect(closed.data.flow.conclusion).toBe('任务已关闭，不再继续推进。');
    expect(closed.data.flow.actions).toEqual([]);
    expect(closed.data.artifacts.at(-1)).toMatchObject({
      type: 'task_closed',
      role: 'system',
      metadata: expect.objectContaining({
        previousLifecycle: expect.any(String),
        previousWorkflowKind: expect.any(String),
        previousThreadStatus: expect.any(String),
        reason: '无需继续',
      }),
    });
    expect(
      closed.data.flow.events.find((event) => event.type === 'task_closed'),
    ).toMatchObject({
      title: '任务已关闭',
      summary: expect.stringContaining('关闭前生命周期：'),
    });
  });

  it('当重复关闭任务时，期望幂等返回当前 closed snapshot', () => {
    const { taskId } = createTaskWithPlan();
    const first = closeTask(taskId);
    expect(first.success).toBe(true);
    const second = closeTask(taskId);
    expect(second.success).toBe(true);
    if (!second.success) throw new Error(second.error);

    expect(second.data.task.status).toBe(TASK_STATUS.CLOSED);
    expect(
      second.data.artifacts.filter(
        (artifact) => artifact.type === 'task_closed',
      ),
    ).toHaveLength(1);
  });

  it('当关闭带开放反馈和运行中 Agent 的任务时，期望关闭反馈并取消运行', () => {
    const { taskId } = createTaskWithPlan();
    const feedback = submitTaskMessage({ taskId, body: '需要补充约束。' });
    expect(feedback.success).toBe(true);
    const snapshot = readTaskPlanningSnapshot(taskId);
    expect(snapshot.success).toBe(true);
    if (!snapshot.success || !snapshot.data)
      throw new Error('missing snapshot');
    const run = createTaskAgentRun({
      taskId,
      threadId: snapshot.data.thread.threadId,
      agentId: 'planning',
      runtimeId: 'codex',
    });
    expect(run.success).toBe(true);

    const closed = closeTask(taskId);
    expect(closed.success).toBe(true);
    if (!closed.success) throw new Error(closed.error);

    expect(closed.data.openRound).toBeNull();
    expect(closed.data.agentRuns[0].status).toBe(AGENT_RUN_STATUS.CANCELLED);
    expect(closed.data.agentStages[0].status).not.toBe(
      AGENT_RUN_STATUS.RUNNING,
    );
    expect(closed.data.flow.blockers).not.toContain(
      '当前反馈轮次已打开，等待 Planner 处理你的补充反馈。',
    );
  });

  it('当取消当前 running agent 时，期望只取消 run 且不关闭 Task', () => {
    const { taskId } = createTaskWithPlan();
    const snapshot = readTaskPlanningSnapshot(taskId);
    expect(snapshot.success).toBe(true);
    if (!snapshot.success || !snapshot.data)
      throw new Error('missing snapshot');
    const run = createTaskAgentRun({
      taskId,
      threadId: snapshot.data.thread.threadId,
      agentId: 'planning',
      runtimeId: 'codex',
    });
    expect(run.success).toBe(true);

    const cancelled = cancelTaskAgentRun({
      taskId,
      reason: '用户中断',
    });
    expect(cancelled.success).toBe(true);
    if (!cancelled.success) throw new Error(cancelled.error);

    expect(cancelled.data.cancelled).toBe(true);
    expect(cancelled.data.runId).toBe(run.success ? run.data.runId : '');
    const refreshed = readTaskPlanningSnapshot(taskId);
    expect(refreshed.success).toBe(true);
    if (!refreshed.success || !refreshed.data)
      throw new Error('missing refreshed snapshot');
    expect(refreshed.data.task.lifecycle).not.toBe(LIFECYCLE.DONE);
    expect(refreshed.data.agentRuns[0].status).toBe(AGENT_RUN_STATUS.CANCELLED);
    expect(
      refreshed.data.agentProgressEvents.some(
        (event) => event.phase === TASK_AGENT_PROGRESS_PHASE.CANCELLED,
      ),
    ).toBe(true);
    expect(
      refreshed.data.artifacts.some(
        (artifact) => artifact.type === 'task_closed',
      ),
    ).toBe(false);
  });

  it('当没有 running agent 时，取消当前 agent 期望幂等返回 false', () => {
    const { taskId } = createTaskWithPlan();
    const cancelled = cancelTaskAgentRun({ taskId });
    expect(cancelled.success).toBe(true);
    if (!cancelled.success) throw new Error(cancelled.error);

    expect(cancelled.data).toEqual({ cancelled: false });
  });

  it('当任务已关闭后继续推进流程时，期望拒绝且不改变 closed 状态', () => {
    const { taskId } = createTaskWithPlan();
    const closed = closeTask(taskId);
    expect(closed.success).toBe(true);

    expect(approveCurrentTaskPlan(taskId).success).toBe(false);
    expect(submitTaskMessage({ taskId, body: '继续' }).success).toBe(false);
    expect(updateTaskStatus(taskId, TASK_STATUS.IMPLEMENTED).success).toBe(
      false,
    );
    expect(
      createTaskAgentRun({
        taskId,
        threadId: closed.success ? closed.data.thread.threadId : 'thread',
        agentId: 'exec',
        runtimeId: 'codex',
      }).success,
    ).toBe(false);

    const refreshed = readTaskPlanningSnapshot(taskId);
    expect(refreshed.success).toBe(true);
    if (!refreshed.success || !refreshed.data)
      throw new Error('missing refreshed snapshot');
    expect(refreshed.data.task.status).toBe(TASK_STATUS.CLOSED);
  });

  it('当反馈改变执行约束时，期望生成新版计划并批准新版计划', () => {
    const { taskId, plan } = createTaskWithPlan();
    const feedback = submitTaskMessage({
      taskId,
      body: '需要明确 Codex session resume 不是事实源。',
    });
    expect(feedback.success).toBe(true);

    const revised = publishTaskPlanRevision({
      taskId,
      body: '## Plan v2\n\n新增 Codex session 只是优化项的约束。',
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

  it('当更新 Agent Binding 时，期望下次读取到同一个 Codex session', () => {
    const { taskId } = createTaskWithPlan();
    const snapshot = readTaskPlanningSnapshot(taskId);
    expect(snapshot.success).toBe(true);
    if (!snapshot.success || !snapshot.data)
      throw new Error('missing snapshot');

    const binding = ensureTaskAgentBinding({
      threadId: snapshot.data.thread.threadId,
      agentId: 'planning',
      runtimeId: 'codex',
      cwd: '/tmp/project',
    });
    expect(binding.success).toBe(true);
    if (!binding.success) throw new Error(binding.error);
    expect(binding.data.runtimeSessionId).toBeUndefined();

    const update = updateTaskAgentRuntimeSession(
      snapshot.data.thread.threadId,
      'planning',
      'codex',
      'session-1',
    );
    expect(update.success).toBe(true);

    const nextBinding = ensureTaskAgentBinding({
      threadId: snapshot.data.thread.threadId,
      agentId: 'planning',
      runtimeId: 'codex',
    });
    expect(nextBinding.success).toBe(true);
    if (!nextBinding.success) throw new Error(nextBinding.error);
    expect(nextBinding.data.runtimeSessionId).toBe('session-1');
  });

  it('当 Binding 缺少 session 但失败 run 有结束 session 时，期望下次绑定可恢复该 session', () => {
    const { taskId } = createTaskWithPlan();
    const snapshot = readTaskPlanningSnapshot(taskId);
    expect(snapshot.success).toBe(true);
    if (!snapshot.success || !snapshot.data)
      throw new Error('missing snapshot');

    const binding = ensureTaskAgentBinding({
      threadId: snapshot.data.thread.threadId,
      agentId: 'exec',
      runtimeId: 'codex',
      cwd: '/tmp/project',
    });
    expect(binding.success).toBe(true);
    if (!binding.success) throw new Error(binding.error);
    expect(binding.data.runtimeSessionId).toBeUndefined();

    const run = createTaskAgentRun({
      taskId,
      threadId: snapshot.data.thread.threadId,
      agentId: 'exec',
      runtimeId: 'codex',
    });
    expect(run.success).toBe(true);
    if (!run.success) throw new Error(run.error);

    const failed = finishTaskAgentRun({
      runId: run.data.runId,
      status: AGENT_RUN_STATUS.FAILED,
      runtimeSessionIdAtEnd: 'codex-thread-failed',
      error: 'Codex failed',
    });
    expect(failed.success).toBe(true);

    const nextBinding = ensureTaskAgentBinding({
      threadId: snapshot.data.thread.threadId,
      agentId: 'exec',
      runtimeId: 'codex',
      cwd: '/tmp/project',
    });
    expect(nextBinding.success).toBe(true);
    if (!nextBinding.success) throw new Error(nextBinding.error);
    expect(nextBinding.data.runtimeSessionId).toBe('codex-thread-failed');
  });

  it('当同一 Task 切到新的 planning thread 时，期望继承历史 Codex session', () => {
    const { taskId } = createTaskWithPlan();
    const snapshot = readTaskPlanningSnapshot(taskId);
    expect(snapshot.success).toBe(true);
    if (!snapshot.success || !snapshot.data)
      throw new Error('missing snapshot');

    const run = createTaskAgentRun({
      taskId,
      threadId: snapshot.data.thread.threadId,
      agentId: 'planning',
      runtimeId: 'codex',
    });
    expect(run.success).toBe(true);
    if (!run.success) throw new Error(run.error);

    const finished = finishTaskAgentRun({
      runId: run.data.runId,
      status: AGENT_RUN_STATUS.SUCCEEDED,
      runtimeSessionIdAtEnd: 'codex-thread-task-latest',
    });
    expect(finished.success).toBe(true);

    const nextBinding = ensureTaskAgentBinding({
      taskId,
      threadId: 'thread-fork',
      agentId: 'planning',
      runtimeId: 'codex',
      cwd: '/tmp/project',
    });
    expect(nextBinding.success).toBe(true);
    if (!nextBinding.success) throw new Error(nextBinding.error);
    expect(nextBinding.data.runtimeSessionId).toBe('codex-thread-task-latest');
  });

  it('当 Agent Binding 的 cwd 变化时，期望清空旧 Codex session', () => {
    const { taskId } = createTaskWithPlan();
    const snapshot = readTaskPlanningSnapshot(taskId);
    expect(snapshot.success).toBe(true);
    if (!snapshot.success || !snapshot.data)
      throw new Error('missing snapshot');

    const binding = ensureTaskAgentBinding({
      threadId: snapshot.data.thread.threadId,
      agentId: 'planning',
      runtimeId: 'codex',
      cwd: '/tmp/project-a',
    });
    expect(binding.success).toBe(true);

    const update = updateTaskAgentRuntimeSession(
      snapshot.data.thread.threadId,
      'planning',
      'codex',
      'session-1',
    );
    expect(update.success).toBe(true);

    const changed = ensureTaskAgentBinding({
      threadId: snapshot.data.thread.threadId,
      agentId: 'planning',
      runtimeId: 'codex',
      cwd: '/tmp/project-b',
    });
    expect(changed.success).toBe(true);
    if (!changed.success) throw new Error(changed.error);
    expect(changed.data.runtimeSessionId).toBeUndefined();

    const stored = readTaskAgentBinding(
      snapshot.data.thread.threadId,
      'planning',
      'codex',
    );
    expect(stored.success).toBe(true);
    if (!stored.success) throw new Error(stored.error);
    expect(stored.data?.cwd).toBe('/tmp/project-b');
    expect(stored.data?.runtimeSessionId).toBeUndefined();
  });

  it('当记录 Agent Run 时，期望能保存开始和结束的 Codex session', () => {
    const { taskId } = createTaskWithPlan();
    const snapshot = readTaskPlanningSnapshot(taskId);
    expect(snapshot.success).toBe(true);
    if (!snapshot.success || !snapshot.data)
      throw new Error('missing snapshot');

    const run = createTaskAgentRun({
      taskId,
      threadId: snapshot.data.thread.threadId,
      agentId: 'planning',
      runtimeId: 'codex',
      runtimeSessionIdAtStart: 'session-1',
      inputArtifactIds: ['art-1'],
    });
    expect(run.success).toBe(true);
    if (!run.success) throw new Error(run.error);
    expect(run.data.status).toBe(AGENT_RUN_STATUS.RUNNING);

    const finished = finishTaskAgentRun({
      runId: run.data.runId,
      status: AGENT_RUN_STATUS.SUCCEEDED,
      runtimeSessionIdAtEnd: 'session-2',
      outputArtifactIds: ['art-2'],
    });
    expect(finished.success).toBe(true);
    if (!finished.success) throw new Error(finished.error);
    expect(finished.data.runtimeSessionIdAtStart).toBe('session-1');
    expect(finished.data.runtimeSessionIdAtEnd).toBe('session-2');
    expect(finished.data.outputArtifactIds).toEqual(['art-2']);
  });

  it('当记录 Agent Progress 时，期望快照包含可序列化进展事件', () => {
    const { taskId } = createTaskWithPlan();
    const snapshot = readTaskPlanningSnapshot(taskId);
    expect(snapshot.success).toBe(true);
    if (!snapshot.success || !snapshot.data)
      throw new Error('missing snapshot');

    const run = createTaskAgentRun({
      taskId,
      threadId: snapshot.data.thread.threadId,
      agentId: 'planning',
      runtimeId: 'codex',
    });
    expect(run.success).toBe(true);
    if (!run.success) throw new Error(run.error);

    const progress = recordTaskAgentProgress({
      runId: run.data.runId,
      taskId,
      threadId: snapshot.data.thread.threadId,
      agentId: 'planning',
      runtimeId: 'codex',
      phase: TASK_AGENT_PROGRESS_PHASE.TOOL,
      summary: '正在执行工具或命令。',
      detail: '只保存用户可理解摘要。',
    });
    expect(progress.success).toBe(true);
    if (!progress.success) throw new Error(progress.error);
    expect(progress.data.phase).toBe('tool');

    const refreshed = readTaskPlanningSnapshot(taskId);
    expect(refreshed.success).toBe(true);
    if (!refreshed.success || !refreshed.data)
      throw new Error('missing refreshed snapshot');
    expect(refreshed.data.agentProgressEvents).toEqual([
      expect.objectContaining({
        runId: run.data.runId,
        agentId: 'planning',
        runtimeId: 'codex',
        phase: 'tool',
        summary: '正在执行工具或命令。',
        detail: '只保存用户可理解摘要。',
      }),
    ]);
  });

  it('当记录 Agent Session 事件时，期望快照包含脱敏后的会话流', () => {
    const { taskId } = createTaskWithPlan();
    const snapshot = readTaskPlanningSnapshot(taskId);
    expect(snapshot.success).toBe(true);
    if (!snapshot.success || !snapshot.data)
      throw new Error('missing snapshot');

    const run = createTaskAgentRun({
      taskId,
      threadId: snapshot.data.thread.threadId,
      agentId: 'planning',
      runtimeId: 'codex',
    });
    expect(run.success).toBe(true);
    if (!run.success) throw new Error(run.error);

    const event = recordTaskAgentSessionEvent({
      runId: run.data.runId,
      taskId,
      threadId: snapshot.data.thread.threadId,
      agentId: 'planning',
      runtimeId: 'codex',
      source: 'agent',
      kind: 'output',
      content: '执行中 TOKEN=secret-value',
    });
    expect(event.success).toBe(true);
    if (!event.success) throw new Error(event.error);

    const refreshed = readTaskPlanningSnapshot(taskId);
    expect(refreshed.success).toBe(true);
    if (!refreshed.success || !refreshed.data)
      throw new Error('missing refreshed snapshot');
    expect(refreshed.data.agentSessionEvents).toEqual([
      expect.objectContaining({
        runId: run.data.runId,
        source: 'agent',
        kind: 'output',
        content: '执行中 TOKEN=[REDACTED]',
      }),
    ]);
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
      agentId: 'planning',
      runtimeId: 'codex',
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

  it('当按仓库列出 Task Planning 快照时，期望只返回当前仓库任务', () => {
    const first = createPlanningTask({
      title: 'Along 任务',
      body: '当前仓库的 planning task。',
      source: 'test',
      repoOwner: 'ranwawa',
      repoName: 'along',
    });
    expect(first.success).toBe(true);
    const second = createPlanningTask({
      title: '其他仓库任务',
      body: '另一个仓库的 planning task。',
      source: 'test',
      repoOwner: 'ranwawa',
      repoName: 'other',
    });
    expect(second.success).toBe(true);

    const list = listTaskPlanningSnapshots(10, {
      repoOwner: 'ranwawa',
      repoName: 'along',
    });
    expect(list.success).toBe(true);
    if (!list.success) throw new Error(list.error);
    expect(list.data.map((item) => item.task.title)).toEqual(['Along 任务']);
  });
});
