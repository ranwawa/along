import crypto from 'node:crypto';
import { iso_timestamp } from '../core/common';
import { getDb } from '../core/db';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';

export const TASK_STATUS = {
  PLANNING: 'planning',
  PLANNING_APPROVED: 'planning_approved',
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

export const THREAD_PURPOSE = {
  PLANNING: 'planning',
} as const;

export type ThreadPurpose =
  (typeof THREAD_PURPOSE)[keyof typeof THREAD_PURPOSE];

export const THREAD_STATUS = {
  DRAFTING: 'drafting',
  AWAITING_APPROVAL: 'awaiting_approval',
  DISCUSSING: 'discussing',
  APPROVED: 'approved',
} as const;

export type ThreadStatus = (typeof THREAD_STATUS)[keyof typeof THREAD_STATUS];

export const ARTIFACT_TYPE = {
  USER_MESSAGE: 'user_message',
  PLAN_REVISION: 'plan_revision',
  PLANNING_UPDATE: 'planning_update',
  APPROVAL: 'approval',
  AGENT_RESULT: 'agent_result',
} as const;

export type ArtifactType = (typeof ARTIFACT_TYPE)[keyof typeof ARTIFACT_TYPE];

export const ARTIFACT_ROLE = {
  USER: 'user',
  AGENT: 'agent',
  SYSTEM: 'system',
} as const;

export type ArtifactRole = (typeof ARTIFACT_ROLE)[keyof typeof ARTIFACT_ROLE];

export const PLAN_STATUS = {
  ACTIVE: 'active',
  SUPERSEDED: 'superseded',
  APPROVED: 'approved',
} as const;

export type TaskPlanStatus = (typeof PLAN_STATUS)[keyof typeof PLAN_STATUS];

export const ROUND_STATUS = {
  OPEN: 'open',
  PROCESSING: 'processing',
  STALE_PARTIAL: 'stale_partial',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
} as const;

export type FeedbackRoundStatus =
  (typeof ROUND_STATUS)[keyof typeof ROUND_STATUS];

export const ROUND_RESOLUTION = {
  ANSWER_ONLY: 'answer_only',
  REVISE_PLAN: 'revise_plan',
} as const;

export type FeedbackRoundResolution =
  (typeof ROUND_RESOLUTION)[keyof typeof ROUND_RESOLUTION];

export const AGENT_RUN_STATUS = {
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
} as const;

export type AgentRunStatus =
  (typeof AGENT_RUN_STATUS)[keyof typeof AGENT_RUN_STATUS];

export interface TaskItemRecord {
  taskId: string;
  title: string;
  body: string;
  source: string;
  status: TaskStatus;
  activeThreadId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskThreadRecord {
  threadId: string;
  taskId: string;
  purpose: ThreadPurpose;
  status: ThreadStatus;
  currentPlanId?: string;
  openRoundId?: string;
  approvedPlanId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskArtifactRecord {
  artifactId: string;
  taskId: string;
  threadId: string;
  type: ArtifactType;
  role: ArtifactRole;
  body: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TaskPlanRevisionRecord {
  planId: string;
  taskId: string;
  threadId: string;
  version: number;
  basedOnPlanId?: string;
  status: TaskPlanStatus;
  artifactId: string;
  body: string;
  createdAt: string;
}

export interface TaskFeedbackRoundRecord {
  roundId: string;
  taskId: string;
  threadId: string;
  basedOnPlanId: string;
  feedbackArtifactIds: string[];
  status: FeedbackRoundStatus;
  resolution?: FeedbackRoundResolution;
  producedPlanId?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface TaskAgentBindingRecord {
  threadId: string;
  agentId: string;
  provider: string;
  providerSessionId?: string;
  cwd?: string;
  model?: string;
  personalityVersion?: string;
  updatedAt: string;
}

export interface TaskAgentRunRecord {
  runId: string;
  taskId: string;
  threadId: string;
  agentId: string;
  provider: string;
  providerSessionIdAtStart?: string;
  providerSessionIdAtEnd?: string;
  status: AgentRunStatus;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  error?: string;
  startedAt: string;
  endedAt?: string;
}

export interface TaskPlanningSnapshot {
  task: TaskItemRecord;
  thread: TaskThreadRecord;
  currentPlan: TaskPlanRevisionRecord | null;
  openRound: TaskFeedbackRoundRecord | null;
  artifacts: TaskArtifactRecord[];
  plans: TaskPlanRevisionRecord[];
}

export interface CreatePlanningTaskInput {
  title: string;
  body: string;
  source?: string;
}

export interface SubmitTaskMessageInput {
  taskId: string;
  body: string;
}

export interface PublishTaskPlanInput {
  taskId: string;
  body: string;
  agentId?: string;
}

export interface PublishPlanningUpdateInput {
  taskId: string;
  body: string;
  agentId?: string;
  kind?: string;
}

export interface EnsureTaskAgentBindingInput {
  threadId: string;
  agentId: string;
  provider: string;
  cwd?: string;
  model?: string;
  personalityVersion?: string;
}

export interface CreateTaskAgentRunInput {
  taskId: string;
  threadId: string;
  agentId: string;
  provider: string;
  providerSessionIdAtStart?: string;
  inputArtifactIds?: string[];
}

export interface FinishTaskAgentRunInput {
  runId: string;
  status: Exclude<AgentRunStatus, 'running'>;
  providerSessionIdAtEnd?: string;
  outputArtifactIds?: string[];
  error?: string;
}

export interface RecordTaskAgentResultInput {
  taskId: string;
  threadId: string;
  body: string;
  agentId?: string;
  provider?: string;
  runId?: string;
}

interface TaskItemRow {
  task_id: string;
  title: string;
  body: string;
  source: string;
  status: TaskStatus;
  active_thread_id: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskThreadRow {
  thread_id: string;
  task_id: string;
  purpose: ThreadPurpose;
  status: ThreadStatus;
  current_plan_id: string | null;
  open_round_id: string | null;
  approved_plan_id: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskArtifactRow {
  artifact_id: string;
  task_id: string;
  thread_id: string;
  type: ArtifactType;
  role: ArtifactRole;
  body: string;
  metadata: string;
  created_at: string;
}

interface TaskPlanRevisionRow {
  plan_id: string;
  task_id: string;
  thread_id: string;
  version: number;
  based_on_plan_id: string | null;
  status: TaskPlanStatus;
  artifact_id: string;
  body: string;
  created_at: string;
}

interface TaskFeedbackRoundRow {
  round_id: string;
  task_id: string;
  thread_id: string;
  based_on_plan_id: string;
  feedback_artifact_ids: string;
  status: FeedbackRoundStatus;
  resolution: FeedbackRoundResolution | null;
  produced_plan_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface TaskAgentBindingRow {
  thread_id: string;
  agent_id: string;
  provider: string;
  provider_session_id: string | null;
  cwd: string | null;
  model: string | null;
  personality_version: string | null;
  updated_at: string;
}

interface TaskAgentRunRow {
  run_id: string;
  task_id: string;
  thread_id: string;
  agent_id: string;
  provider: string;
  provider_session_id_at_start: string | null;
  provider_session_id_at_end: string | null;
  status: AgentRunStatus;
  input_artifact_ids: string;
  output_artifact_ids: string;
  error: string | null;
  started_at: string;
  ended_at: string | null;
}

interface TaskIdRow {
  task_id: string;
}

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseMetadata(
  value: string | null | undefined,
): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function mapTask(row: TaskItemRow): TaskItemRecord {
  return {
    taskId: row.task_id,
    title: row.title,
    body: row.body,
    source: row.source,
    status: row.status,
    activeThreadId: row.active_thread_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapThread(row: TaskThreadRow): TaskThreadRecord {
  return {
    threadId: row.thread_id,
    taskId: row.task_id,
    purpose: row.purpose,
    status: row.status,
    currentPlanId: row.current_plan_id || undefined,
    openRoundId: row.open_round_id || undefined,
    approvedPlanId: row.approved_plan_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapArtifact(row: TaskArtifactRow): TaskArtifactRecord {
  return {
    artifactId: row.artifact_id,
    taskId: row.task_id,
    threadId: row.thread_id,
    type: row.type,
    role: row.role,
    body: row.body,
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at,
  };
}

function mapPlan(row: TaskPlanRevisionRow): TaskPlanRevisionRecord {
  return {
    planId: row.plan_id,
    taskId: row.task_id,
    threadId: row.thread_id,
    version: row.version,
    basedOnPlanId: row.based_on_plan_id || undefined,
    status: row.status,
    artifactId: row.artifact_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

function mapRound(row: TaskFeedbackRoundRow): TaskFeedbackRoundRecord {
  return {
    roundId: row.round_id,
    taskId: row.task_id,
    threadId: row.thread_id,
    basedOnPlanId: row.based_on_plan_id,
    feedbackArtifactIds: parseStringArray(row.feedback_artifact_ids),
    status: row.status,
    resolution: row.resolution || undefined,
    producedPlanId: row.produced_plan_id || undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || undefined,
  };
}

function mapBinding(row: TaskAgentBindingRow): TaskAgentBindingRecord {
  return {
    threadId: row.thread_id,
    agentId: row.agent_id,
    provider: row.provider,
    providerSessionId: row.provider_session_id || undefined,
    cwd: row.cwd || undefined,
    model: row.model || undefined,
    personalityVersion: row.personality_version || undefined,
    updatedAt: row.updated_at,
  };
}

function mapRun(row: TaskAgentRunRow): TaskAgentRunRecord {
  return {
    runId: row.run_id,
    taskId: row.task_id,
    threadId: row.thread_id,
    agentId: row.agent_id,
    provider: row.provider,
    providerSessionIdAtStart: row.provider_session_id_at_start || undefined,
    providerSessionIdAtEnd: row.provider_session_id_at_end || undefined,
    status: row.status,
    inputArtifactIds: parseStringArray(row.input_artifact_ids),
    outputArtifactIds: parseStringArray(row.output_artifact_ids),
    error: row.error || undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at || undefined,
  };
}

function getActiveThreadRow(taskId: string): Result<TaskThreadRow | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const row = dbRes.data
      .prepare(
        `
          SELECT tt.*
          FROM task_threads tt
          JOIN task_items ti ON ti.active_thread_id = tt.thread_id
          WHERE ti.task_id = ?
        `,
      )
      .get(taskId) as TaskThreadRow | null;
    return success(row);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`读取 Task Thread 失败: ${message}`);
  }
}

function insertArtifact(input: {
  taskId: string;
  threadId: string;
  type: ArtifactType;
  role: ArtifactRole;
  body: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}): TaskArtifactRecord {
  const dbRes = getDb();
  if (!dbRes.success) throw new Error(dbRes.error);

  const artifactId = generateId('art');
  dbRes.data
    .prepare(
      `
        INSERT INTO task_artifacts (
          artifact_id, task_id, thread_id, type, role, body, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      artifactId,
      input.taskId,
      input.threadId,
      input.type,
      input.role,
      input.body,
      JSON.stringify(input.metadata || {}),
      input.createdAt,
    );

  return {
    artifactId,
    taskId: input.taskId,
    threadId: input.threadId,
    type: input.type,
    role: input.role,
    body: input.body,
    metadata: input.metadata || {},
    createdAt: input.createdAt,
  };
}

export function createPlanningTask(
  input: CreatePlanningTaskInput,
): Result<TaskPlanningSnapshot> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) return failure('Task 标题不能为空');
  if (!body) return failure('Task 内容不能为空');

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const taskId = generateId('task');
    const threadId = generateId('thread');
    const now = iso_timestamp();

    const txn = db.transaction(() => {
      db.prepare(
        `
          INSERT INTO task_items (
            task_id, title, body, source, status, active_thread_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        taskId,
        title,
        body,
        input.source || 'web',
        TASK_STATUS.PLANNING,
        threadId,
        now,
        now,
      );

      db.prepare(
        `
          INSERT INTO task_threads (
            thread_id, task_id, purpose, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      ).run(
        threadId,
        taskId,
        THREAD_PURPOSE.PLANNING,
        THREAD_STATUS.DRAFTING,
        now,
        now,
      );

      insertArtifact({
        taskId,
        threadId,
        type: ARTIFACT_TYPE.USER_MESSAGE,
        role: ARTIFACT_ROLE.USER,
        body,
        metadata: { kind: 'initial_request' },
        createdAt: now,
      });
    });

    txn();
    const snapshot = readTaskPlanningSnapshot(taskId);
    return snapshot.success && snapshot.data
      ? success(snapshot.data)
      : failure('创建 Task 后读取快照失败');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`创建 Task 失败: ${message}`);
  }
}

export function readTaskPlanningSnapshot(
  taskId: string,
): Result<TaskPlanningSnapshot | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const taskRow = db
      .prepare('SELECT * FROM task_items WHERE task_id = ?')
      .get(taskId) as TaskItemRow | null;
    if (!taskRow) return success(null);

    const threadRow = db
      .prepare('SELECT * FROM task_threads WHERE thread_id = ? AND task_id = ?')
      .get(taskRow.active_thread_id, taskId) as TaskThreadRow | null;
    if (!threadRow) {
      return failure(`Task ${taskId} 缺少 active planning thread`);
    }

    const currentPlanRow = threadRow.current_plan_id
      ? (db
          .prepare(
            'SELECT * FROM task_plan_revisions WHERE plan_id = ? AND thread_id = ?',
          )
          .get(
            threadRow.current_plan_id,
            threadRow.thread_id,
          ) as TaskPlanRevisionRow | null)
      : null;

    const openRoundRow = threadRow.open_round_id
      ? (db
          .prepare(
            'SELECT * FROM task_feedback_rounds WHERE round_id = ? AND thread_id = ?',
          )
          .get(
            threadRow.open_round_id,
            threadRow.thread_id,
          ) as TaskFeedbackRoundRow | null)
      : null;

    const artifactRows = db
      .prepare(
        'SELECT * FROM task_artifacts WHERE thread_id = ? ORDER BY created_at ASC',
      )
      .all(threadRow.thread_id) as TaskArtifactRow[];
    const planRows = db
      .prepare(
        'SELECT * FROM task_plan_revisions WHERE thread_id = ? ORDER BY version ASC',
      )
      .all(threadRow.thread_id) as TaskPlanRevisionRow[];

    return success({
      task: mapTask(taskRow),
      thread: mapThread(threadRow),
      currentPlan: currentPlanRow ? mapPlan(currentPlanRow) : null,
      openRound: openRoundRow ? mapRound(openRoundRow) : null,
      artifacts: artifactRows.map(mapArtifact),
      plans: planRows.map(mapPlan),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`读取 Task Planning 快照失败: ${message}`);
  }
}

export function listTaskPlanningSnapshots(
  limit = 100,
): Result<TaskPlanningSnapshot[]> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = db
      .prepare(
        'SELECT task_id FROM task_items ORDER BY updated_at DESC LIMIT ?',
      )
      .all(safeLimit) as TaskIdRow[];
    const snapshots: TaskPlanningSnapshot[] = [];

    for (const row of rows) {
      const snapshotRes = readTaskPlanningSnapshot(row.task_id);
      if (!snapshotRes.success) return snapshotRes;
      if (snapshotRes.data) snapshots.push(snapshotRes.data);
    }

    return success(snapshots);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`列出 Task Planning 快照失败: ${message}`);
  }
}

export function submitTaskMessage(input: SubmitTaskMessageInput): Result<{
  artifact: TaskArtifactRecord;
  round: TaskFeedbackRoundRecord | null;
}> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;
  const body = input.body.trim();
  if (!body) return failure('用户消息不能为空');

  const threadRes = getActiveThreadRow(input.taskId);
  if (!threadRes.success) return threadRes;
  const thread = threadRes.data;
  if (!thread)
    return failure(`Task 不存在或缺少 active thread: ${input.taskId}`);
  if (thread.status === THREAD_STATUS.APPROVED) {
    return failure('当前 Planning 已批准，不能继续提交反馈');
  }

  try {
    const now = iso_timestamp();
    let createdArtifact: TaskArtifactRecord | null = null;
    let roundResult: TaskFeedbackRoundRecord | null = null;

    const txn = db.transaction(() => {
      createdArtifact = insertArtifact({
        taskId: thread.task_id,
        threadId: thread.thread_id,
        type: ARTIFACT_TYPE.USER_MESSAGE,
        role: ARTIFACT_ROLE.USER,
        body,
        metadata: thread.current_plan_id
          ? { kind: 'planning_feedback', basedOnPlanId: thread.current_plan_id }
          : { kind: 'additional_context' },
        createdAt: now,
      });

      if (!thread.current_plan_id || !createdArtifact) {
        db.prepare(
          'UPDATE task_threads SET updated_at = ? WHERE thread_id = ?',
        ).run(now, thread.thread_id);
        db.prepare(
          'UPDATE task_items SET updated_at = ? WHERE task_id = ?',
        ).run(now, thread.task_id);
        return;
      }

      let roundRow = thread.open_round_id
        ? (db
            .prepare(
              'SELECT * FROM task_feedback_rounds WHERE round_id = ? AND thread_id = ?',
            )
            .get(
              thread.open_round_id,
              thread.thread_id,
            ) as TaskFeedbackRoundRow | null)
        : null;

      if (!roundRow) {
        const roundId = generateId('round');
        const ids = [createdArtifact.artifactId];
        db.prepare(
          `
            INSERT INTO task_feedback_rounds (
              round_id, task_id, thread_id, based_on_plan_id, feedback_artifact_ids,
              status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          roundId,
          thread.task_id,
          thread.thread_id,
          thread.current_plan_id,
          JSON.stringify(ids),
          ROUND_STATUS.OPEN,
          now,
        );
        db.prepare(
          `
            UPDATE task_threads
            SET status = ?, open_round_id = ?, updated_at = ?
            WHERE thread_id = ?
          `,
        ).run(THREAD_STATUS.DISCUSSING, roundId, now, thread.thread_id);
        roundRow = {
          round_id: roundId,
          task_id: thread.task_id,
          thread_id: thread.thread_id,
          based_on_plan_id: thread.current_plan_id,
          feedback_artifact_ids: JSON.stringify(ids),
          status: ROUND_STATUS.OPEN,
          resolution: null,
          produced_plan_id: null,
          created_at: now,
          resolved_at: null,
        };
      } else {
        const ids = parseStringArray(roundRow.feedback_artifact_ids);
        ids.push(createdArtifact.artifactId);
        db.prepare(
          `
            UPDATE task_feedback_rounds
            SET feedback_artifact_ids = ?, status = ?
            WHERE round_id = ?
          `,
        ).run(JSON.stringify(ids), ROUND_STATUS.OPEN, roundRow.round_id);
        db.prepare(
          `
            UPDATE task_threads
            SET status = ?, updated_at = ?
            WHERE thread_id = ?
          `,
        ).run(THREAD_STATUS.DISCUSSING, now, thread.thread_id);
        roundRow = {
          ...roundRow,
          feedback_artifact_ids: JSON.stringify(ids),
          status: ROUND_STATUS.OPEN,
        };
      }

      db.prepare('UPDATE task_items SET updated_at = ? WHERE task_id = ?').run(
        now,
        thread.task_id,
      );
      roundResult = mapRound(roundRow);
    });

    txn();
    if (!createdArtifact) return failure('提交消息后缺少 artifact');
    return success({ artifact: createdArtifact, round: roundResult });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`提交 Task 消息失败: ${message}`);
  }
}

export function publishTaskPlanRevision(
  input: PublishTaskPlanInput,
): Result<TaskPlanRevisionRecord> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;
  const body = input.body.trim();
  if (!body) return failure('Plan 内容不能为空');

  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${input.taskId}`);
  if (snapshot.thread.status === THREAD_STATUS.APPROVED) {
    return failure('当前 Planning 已批准，不能发布新版 Plan');
  }
  if (snapshot.currentPlan && !snapshot.openRound) {
    return failure('当前没有待处理反馈，不能覆盖现有 Plan');
  }

  try {
    const now = iso_timestamp();
    let plan: TaskPlanRevisionRecord | null = null;

    const txn = db.transaction(() => {
      const nextVersion = snapshot.plans.length + 1;
      const planId = generateId('plan');
      const artifact = insertArtifact({
        taskId: snapshot.task.taskId,
        threadId: snapshot.thread.threadId,
        type: ARTIFACT_TYPE.PLAN_REVISION,
        role: ARTIFACT_ROLE.AGENT,
        body,
        metadata: {
          agentId: input.agentId || 'planner',
          version: nextVersion,
          basedOnPlanId: snapshot.currentPlan?.planId,
          roundId: snapshot.openRound?.roundId,
        },
        createdAt: now,
      });

      db.prepare(
        `
          UPDATE task_plan_revisions
          SET status = ?
          WHERE thread_id = ? AND status = ?
        `,
      ).run(
        PLAN_STATUS.SUPERSEDED,
        snapshot.thread.threadId,
        PLAN_STATUS.ACTIVE,
      );

      db.prepare(
        `
          INSERT INTO task_plan_revisions (
            plan_id, task_id, thread_id, version, based_on_plan_id, status,
            artifact_id, body, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        planId,
        snapshot.task.taskId,
        snapshot.thread.threadId,
        nextVersion,
        snapshot.currentPlan?.planId || null,
        PLAN_STATUS.ACTIVE,
        artifact.artifactId,
        body,
        now,
      );

      if (snapshot.openRound) {
        db.prepare(
          `
            UPDATE task_feedback_rounds
            SET status = ?, resolution = ?, produced_plan_id = ?, resolved_at = ?
            WHERE round_id = ?
          `,
        ).run(
          ROUND_STATUS.RESOLVED,
          ROUND_RESOLUTION.REVISE_PLAN,
          planId,
          now,
          snapshot.openRound.roundId,
        );
      }

      db.prepare(
        `
          UPDATE task_threads
          SET status = ?, current_plan_id = ?, open_round_id = NULL, updated_at = ?
          WHERE thread_id = ?
        `,
      ).run(
        THREAD_STATUS.AWAITING_APPROVAL,
        planId,
        now,
        snapshot.thread.threadId,
      );
      db.prepare('UPDATE task_items SET updated_at = ? WHERE task_id = ?').run(
        now,
        snapshot.task.taskId,
      );

      plan = {
        planId,
        taskId: snapshot.task.taskId,
        threadId: snapshot.thread.threadId,
        version: nextVersion,
        basedOnPlanId: snapshot.currentPlan?.planId,
        status: PLAN_STATUS.ACTIVE,
        artifactId: artifact.artifactId,
        body,
        createdAt: now,
      };
    });

    txn();
    return plan ? success(plan) : failure('发布 Plan 后缺少结果');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`发布 Task Plan 失败: ${message}`);
  }
}

export function publishPlanningUpdate(
  input: PublishPlanningUpdateInput,
): Result<TaskArtifactRecord> {
  const body = input.body.trim();
  if (!body) return failure('Planning Update 内容不能为空');

  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${input.taskId}`);
  if (snapshot.thread.status === THREAD_STATUS.APPROVED) {
    return failure('当前 Planning 已批准，不能发布 Update');
  }
  if (snapshot.currentPlan && !snapshot.openRound)
    return failure('当前没有待处理反馈，无法发布 Update');

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const now = iso_timestamp();
    let artifact: TaskArtifactRecord | null = null;

    const txn = db.transaction(() => {
      artifact = insertArtifact({
        taskId: snapshot.task.taskId,
        threadId: snapshot.thread.threadId,
        type: ARTIFACT_TYPE.PLANNING_UPDATE,
        role: ARTIFACT_ROLE.AGENT,
        body,
        metadata: {
          agentId: input.agentId || 'planner',
          roundId: snapshot.openRound?.roundId,
          basedOnPlanId: snapshot.currentPlan?.planId,
          kind:
            input.kind ||
            (snapshot.currentPlan ? 'answer_only' : 'pre_plan_clarification'),
        },
        createdAt: now,
      });

      if (snapshot.openRound) {
        db.prepare(
          `
            UPDATE task_feedback_rounds
            SET status = ?, resolution = ?, resolved_at = ?
            WHERE round_id = ?
          `,
        ).run(
          ROUND_STATUS.RESOLVED,
          ROUND_RESOLUTION.ANSWER_ONLY,
          now,
          snapshot.openRound.roundId,
        );
        db.prepare(
          `
            UPDATE task_threads
            SET status = ?, open_round_id = NULL, updated_at = ?
            WHERE thread_id = ?
          `,
        ).run(THREAD_STATUS.AWAITING_APPROVAL, now, snapshot.thread.threadId);
      } else {
        db.prepare(
          `
            UPDATE task_threads
            SET status = ?, updated_at = ?
            WHERE thread_id = ?
          `,
        ).run(THREAD_STATUS.DISCUSSING, now, snapshot.thread.threadId);
      }

      db.prepare('UPDATE task_items SET updated_at = ? WHERE task_id = ?').run(
        now,
        snapshot.task.taskId,
      );
    });

    txn();
    return artifact ? success(artifact) : failure('发布 Update 后缺少结果');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`发布 Planning Update 失败: ${message}`);
  }
}

export function recordTaskAgentResult(
  input: RecordTaskAgentResultInput,
): Result<TaskArtifactRecord> {
  const body = input.body.trim();
  if (!body) return failure('Agent Result 内容不能为空');

  try {
    const artifact = insertArtifact({
      taskId: input.taskId,
      threadId: input.threadId,
      type: ARTIFACT_TYPE.AGENT_RESULT,
      role: ARTIFACT_ROLE.AGENT,
      body,
      metadata: {
        agentId: input.agentId || 'agent',
        provider: input.provider || 'unknown',
        runId: input.runId,
      },
      createdAt: iso_timestamp(),
    });
    return success(artifact);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`记录 Agent Result 失败: ${message}`);
  }
}

export function approveCurrentTaskPlan(
  taskId: string,
): Result<TaskPlanRevisionRecord> {
  const snapshotRes = readTaskPlanningSnapshot(taskId);
  if (!snapshotRes.success) return snapshotRes;
  const snapshot = snapshotRes.data;
  if (!snapshot) return failure(`Task 不存在: ${taskId}`);
  if (!snapshot.currentPlan) return failure('当前没有可批准的正式 Plan');
  if (snapshot.openRound) {
    return failure(`当前仍有待处理反馈轮次: ${snapshot.openRound.roundId}`);
  }
  if (snapshot.currentPlan.status !== PLAN_STATUS.ACTIVE) {
    return failure('只能批准当前 active Plan');
  }

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const now = iso_timestamp();

    const txn = db.transaction(() => {
      insertArtifact({
        taskId: snapshot.task.taskId,
        threadId: snapshot.thread.threadId,
        type: ARTIFACT_TYPE.APPROVAL,
        role: ARTIFACT_ROLE.USER,
        body: `Approved Plan v${snapshot.currentPlan?.version}`,
        metadata: { planId: snapshot.currentPlan?.planId },
        createdAt: now,
      });
      db.prepare(
        'UPDATE task_plan_revisions SET status = ? WHERE plan_id = ?',
      ).run(PLAN_STATUS.APPROVED, snapshot.currentPlan?.planId);
      db.prepare(
        `
          UPDATE task_threads
          SET status = ?, approved_plan_id = ?, updated_at = ?
          WHERE thread_id = ?
        `,
      ).run(
        THREAD_STATUS.APPROVED,
        snapshot.currentPlan?.planId,
        now,
        snapshot.thread.threadId,
      );
      db.prepare(
        `
          UPDATE task_items
          SET status = ?, updated_at = ?
          WHERE task_id = ?
        `,
      ).run(TASK_STATUS.PLANNING_APPROVED, now, snapshot.task.taskId);
    });

    txn();
    return success({
      ...snapshot.currentPlan,
      status: PLAN_STATUS.APPROVED,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`批准 Task Plan 失败: ${message}`);
  }
}

export function ensureTaskAgentBinding(
  input: EnsureTaskAgentBindingInput,
): Result<TaskAgentBindingRecord> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const now = iso_timestamp();
    const existing = db
      .prepare(
        `
          SELECT * FROM task_agent_bindings
          WHERE thread_id = ? AND agent_id = ? AND provider = ?
        `,
      )
      .get(
        input.threadId,
        input.agentId,
        input.provider,
      ) as TaskAgentBindingRow | null;

    if (!existing) {
      db.prepare(
        `
          INSERT INTO task_agent_bindings (
            thread_id, agent_id, provider, cwd, model, personality_version, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        input.threadId,
        input.agentId,
        input.provider,
        input.cwd || null,
        input.model || null,
        input.personalityVersion || null,
        now,
      );
    } else {
      db.prepare(
        `
          UPDATE task_agent_bindings
          SET cwd = COALESCE(?, cwd),
              model = COALESCE(?, model),
              personality_version = COALESCE(?, personality_version),
              updated_at = ?
          WHERE thread_id = ? AND agent_id = ? AND provider = ?
        `,
      ).run(
        input.cwd || null,
        input.model || null,
        input.personalityVersion || null,
        now,
        input.threadId,
        input.agentId,
        input.provider,
      );
    }

    const row = db
      .prepare(
        `
          SELECT * FROM task_agent_bindings
          WHERE thread_id = ? AND agent_id = ? AND provider = ?
        `,
      )
      .get(
        input.threadId,
        input.agentId,
        input.provider,
      ) as TaskAgentBindingRow | null;

    return row
      ? success(mapBinding(row))
      : failure('创建 Agent Binding 后读取失败');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`确保 Agent Binding 失败: ${message}`);
  }
}

export function updateTaskAgentProviderSession(
  threadId: string,
  agentId: string,
  provider: string,
  providerSessionId: string,
): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    dbRes.data
      .prepare(
        `
          UPDATE task_agent_bindings
          SET provider_session_id = ?, updated_at = ?
          WHERE thread_id = ? AND agent_id = ? AND provider = ?
        `,
      )
      .run(providerSessionId, iso_timestamp(), threadId, agentId, provider);
    return success(undefined);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`更新 provider session 失败: ${message}`);
  }
}

export function createTaskAgentRun(
  input: CreateTaskAgentRunInput,
): Result<TaskAgentRunRecord> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const runId = generateId('run');
  const now = iso_timestamp();
  const inputArtifactIds = input.inputArtifactIds || [];

  try {
    dbRes.data
      .prepare(
        `
          INSERT INTO task_agent_runs (
            run_id, task_id, thread_id, agent_id, provider,
            provider_session_id_at_start, status, input_artifact_ids, started_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        runId,
        input.taskId,
        input.threadId,
        input.agentId,
        input.provider,
        input.providerSessionIdAtStart || null,
        AGENT_RUN_STATUS.RUNNING,
        JSON.stringify(inputArtifactIds),
        now,
      );

    return success({
      runId,
      taskId: input.taskId,
      threadId: input.threadId,
      agentId: input.agentId,
      provider: input.provider,
      providerSessionIdAtStart: input.providerSessionIdAtStart,
      status: AGENT_RUN_STATUS.RUNNING,
      inputArtifactIds,
      outputArtifactIds: [],
      startedAt: now,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`创建 Agent Run 失败: ${message}`);
  }
}

export function finishTaskAgentRun(
  input: FinishTaskAgentRunInput,
): Result<TaskAgentRunRecord> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const endedAt = iso_timestamp();

  try {
    dbRes.data
      .prepare(
        `
          UPDATE task_agent_runs
          SET status = ?,
              provider_session_id_at_end = ?,
              output_artifact_ids = ?,
              error = ?,
              ended_at = ?
          WHERE run_id = ?
        `,
      )
      .run(
        input.status,
        input.providerSessionIdAtEnd || null,
        JSON.stringify(input.outputArtifactIds || []),
        input.error || null,
        endedAt,
        input.runId,
      );

    const row = dbRes.data
      .prepare('SELECT * FROM task_agent_runs WHERE run_id = ?')
      .get(input.runId) as TaskAgentRunRow | null;
    return row ? success(mapRun(row)) : failure('结束 Agent Run 后读取失败');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`结束 Agent Run 失败: ${message}`);
  }
}
