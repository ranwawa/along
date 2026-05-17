import type { Database } from 'bun:sqlite';
import { getDb } from '../../core/db';
import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import {
  mapTaskAttachment,
  type TaskAttachmentRecord,
  type TaskAttachmentRow,
} from '../task/attachments';
import {
  buildTaskAgentStages,
  mapArtifact,
  mapBinding,
  mapPlan,
  mapProgressEvent,
  mapRound,
  mapRun,
  mapSessionEvent,
  mapTask,
  mapThread,
  type ReadTaskPlanningSnapshotOptions,
  type TaskAgentBindingRow,
  type TaskAgentProgressEventRow,
  type TaskAgentRunRow,
  type TaskAgentSessionEventRow,
  type TaskArtifactRow,
  type TaskFeedbackRoundRow,
  type TaskIdRow,
  type TaskItemRecord,
  type TaskItemRow,
  type TaskPlanningSnapshot,
  type TaskPlanRevisionRow,
  type TaskThreadRow,
} from './';
import { applyWorkflowView, buildTaskFlowSnapshot } from './flow';

function groupAttachmentsByArtifact(
  rows: TaskAttachmentRow[],
  task: TaskItemRecord,
): Map<string, TaskAttachmentRecord[]> {
  const grouped = new Map<string, TaskAttachmentRecord[]>();
  for (const row of rows) {
    const existing = grouped.get(row.artifact_id) || [];
    existing.push(mapTaskAttachment(row, task));
    grouped.set(row.artifact_id, existing);
  }
  return grouped;
}

const SESSION_LIMIT = 200;
const MIN_LIMIT = 1;
const MAX_LIMIT = 500;

type ThreadRows = {
  currentPlanRow: TaskPlanRevisionRow | null;
  openRoundRow: TaskFeedbackRoundRow | null;
  artifactRows: TaskArtifactRow[];
  planRows: TaskPlanRevisionRow[];
  bindingRows: TaskAgentBindingRow[];
  runRows: TaskAgentRunRow[];
  progressRows: TaskAgentProgressEventRow[];
  sessionEventRows: TaskAgentSessionEventRow[];
  attachmentRows: TaskAttachmentRow[];
};

function fetchPlanAndRoundRows(
  db: Database,
  threadRow: TaskThreadRow,
): Pick<ThreadRows, 'currentPlanRow' | 'openRoundRow'> {
  const tid = threadRow.thread_id;
  const currentPlanRow = threadRow.current_plan_id
    ? (db
        .prepare(
          'SELECT * FROM task_plan_revisions WHERE plan_id = ? AND thread_id = ?',
        )
        .get(threadRow.current_plan_id, tid) as TaskPlanRevisionRow | null)
    : null;
  const openRoundRow = threadRow.open_round_id
    ? (db
        .prepare(
          'SELECT * FROM task_feedback_rounds WHERE round_id = ? AND thread_id = ?',
        )
        .get(threadRow.open_round_id, tid) as TaskFeedbackRoundRow | null)
    : null;
  return { currentPlanRow, openRoundRow };
}

function fetchAgentRows(
  db: Database,
  tid: string,
  includeSessionEvents: boolean,
): Pick<
  ThreadRows,
  'bindingRows' | 'runRows' | 'progressRows' | 'sessionEventRows'
> {
  const bindingRows = db
    .prepare('SELECT * FROM task_agent_bindings WHERE thread_id = ?')
    .all(tid) as TaskAgentBindingRow[];
  const runRows = db
    .prepare(
      'SELECT * FROM task_agent_runs WHERE thread_id = ? ORDER BY started_at ASC',
    )
    .all(tid) as TaskAgentRunRow[];
  const progressRows = db
    .prepare(
      'SELECT * FROM task_agent_progress_events WHERE thread_id = ? ORDER BY created_at ASC',
    )
    .all(tid) as TaskAgentProgressEventRow[];
  const sessionEventRows = includeSessionEvents
    ? (db
        .prepare(
          `SELECT * FROM (SELECT * FROM task_agent_session_events WHERE thread_id = ? ORDER BY created_at DESC LIMIT ${SESSION_LIMIT}) ORDER BY created_at ASC`,
        )
        .all(tid) as TaskAgentSessionEventRow[])
    : [];
  return { bindingRows, runRows, progressRows, sessionEventRows };
}

function fetchThreadRows(
  db: Database,
  threadRow: TaskThreadRow,
  options: ReadTaskPlanningSnapshotOptions,
): ThreadRows {
  const tid = threadRow.thread_id;
  const { currentPlanRow, openRoundRow } = fetchPlanAndRoundRows(db, threadRow);
  const artifactRows = db
    .prepare(
      'SELECT * FROM task_artifacts WHERE thread_id = ? ORDER BY created_at ASC',
    )
    .all(tid) as TaskArtifactRow[];
  const planRows = db
    .prepare(
      'SELECT * FROM task_plan_revisions WHERE thread_id = ? ORDER BY version ASC',
    )
    .all(tid) as TaskPlanRevisionRow[];
  const attachmentRows = db
    .prepare(
      'SELECT * FROM task_attachments WHERE thread_id = ? ORDER BY created_at ASC',
    )
    .all(tid) as TaskAttachmentRow[];
  const agentRows = fetchAgentRows(
    db,
    tid,
    options.includeSessionEvents !== false,
  );
  return {
    currentPlanRow,
    openRoundRow,
    artifactRows,
    planRows,
    attachmentRows,
    ...agentRows,
  };
}

function mapSnapshotRecords(rows: ThreadRows, taskRow: TaskItemRow) {
  const mappedTask = mapTask(taskRow);
  const attachmentsByArtifact = groupAttachmentsByArtifact(
    rows.attachmentRows,
    mappedTask,
  );
  const artifacts = rows.artifactRows.map((row) => ({
    ...mapArtifact(row),
    attachments: attachmentsByArtifact.get(row.artifact_id) || [],
  }));
  const agentRuns = rows.runRows.map(mapRun);
  const agentBindings = rows.bindingRows.map(mapBinding);
  const agentStages = buildTaskAgentStages(
    agentRuns,
    agentBindings,
    mappedTask,
  );
  return {
    mappedTask,
    artifacts,
    plans: rows.planRows.map(mapPlan),
    agentRuns,
    agentBindings,
    agentStages,
    agentProgressEvents: rows.progressRows.map(mapProgressEvent),
    agentSessionEvents: rows.sessionEventRows.map(mapSessionEvent),
  };
}

type MappedRecords = ReturnType<typeof mapSnapshotRecords>;

function assembleSnapshot(
  workflowView: ReturnType<typeof applyWorkflowView>,
  currentPlan: ReturnType<typeof mapPlan> | null,
  openRound: ReturnType<typeof mapRound> | null,
  mapped: MappedRecords,
): TaskPlanningSnapshot {
  const { task, thread } = workflowView;
  return {
    task,
    thread,
    display: workflowView.display,
    currentPlan,
    openRound,
    artifacts: mapped.artifacts,
    plans: mapped.plans,
    agentRuns: mapped.agentRuns,
    agentProgressEvents: mapped.agentProgressEvents,
    agentSessionEvents: mapped.agentSessionEvents,
    agentStages: mapped.agentStages,
    flow: buildTaskFlowSnapshot({
      task,
      thread,
      currentPlan,
      openRound,
      artifacts: mapped.artifacts,
      plans: mapped.plans,
      agentRuns: mapped.agentRuns,
      agentProgressEvents: mapped.agentProgressEvents,
      agentStages: mapped.agentStages,
    }),
  };
}

function buildSnapshot(
  taskRow: TaskItemRow,
  threadRow: TaskThreadRow,
  rows: ThreadRows,
): TaskPlanningSnapshot {
  const currentPlan = rows.currentPlanRow ? mapPlan(rows.currentPlanRow) : null;
  const openRound = rows.openRoundRow ? mapRound(rows.openRoundRow) : null;
  const mapped = mapSnapshotRecords(rows, taskRow);
  const workflowView = applyWorkflowView({
    task: mapped.mappedTask,
    thread: mapThread(threadRow),
    currentPlan,
    openRound,
    agentStages: mapped.agentStages,
  });
  return assembleSnapshot(workflowView, currentPlan, openRound, mapped);
}

export function readTaskPlanningSnapshot(
  taskId: string,
  options: ReadTaskPlanningSnapshotOptions = {},
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
    if (!threadRow)
      return failure(`Task ${taskId} 缺少 active planning thread`);

    return success(
      buildSnapshot(
        taskRow,
        threadRow,
        fetchThreadRows(db, threadRow, options),
      ),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`读取 Task Planning 快照失败: ${message}`);
  }
}

function fetchTaskIds(
  db: Database,
  safeLimit: number,
  filter: { repoOwner?: string; repoName?: string },
): TaskIdRow[] {
  if (filter.repoOwner && filter.repoName) {
    return db
      .prepare(
        'SELECT task_id FROM task_items WHERE repo_owner = ? AND repo_name = ? ORDER BY updated_at DESC LIMIT ?',
      )
      .all(filter.repoOwner, filter.repoName, safeLimit) as TaskIdRow[];
  }
  return db
    .prepare('SELECT task_id FROM task_items ORDER BY updated_at DESC LIMIT ?')
    .all(safeLimit) as TaskIdRow[];
}

export function listTaskPlanningSnapshots(
  limit = 100,
  filter: { repoOwner?: string; repoName?: string } = {},
): Result<TaskPlanningSnapshot[]> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const db = dbRes.data;

  try {
    const safeLimit = Math.max(
      MIN_LIMIT,
      Math.min(MAX_LIMIT, Math.floor(limit)),
    );
    const rows = fetchTaskIds(db, safeLimit, filter);
    const snapshots: TaskPlanningSnapshot[] = [];

    for (const row of rows) {
      const snapshotRes = readTaskPlanningSnapshot(row.task_id, {
        includeSessionEvents: false,
      });
      if (!snapshotRes.success) return snapshotRes;
      if (snapshotRes.data) snapshots.push(snapshotRes.data);
    }

    return success(snapshots);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`列出 Task Planning 快照失败: ${message}`);
  }
}
