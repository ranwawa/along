import crypto from 'node:crypto';
import fs from 'node:fs';
import { consola } from 'consola';
import { iso_timestamp } from '../core/common';
import { getDb } from '../core/db';
import { failure, type Result, success } from '../core/result';
import type { SessionPathManager } from '../core/session-paths';
import { COMMAND } from './session-state-machine';

const logger = consola.withTag('planning-state');

export const PLAN_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  SUPERSEDED: 'superseded',
  APPROVED: 'approved',
  CLOSED: 'closed',
} as const;

export type PlanStatus = (typeof PLAN_STATUS)[keyof typeof PLAN_STATUS];

export const ROUND_STATUS = {
  OPEN: 'open',
  PROCESSING: 'processing',
  STALE_PARTIAL: 'stale_partial',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
} as const;

export type DiscussionRoundStatus =
  (typeof ROUND_STATUS)[keyof typeof ROUND_STATUS];

export const ROUND_RESOLUTION = {
  ANSWER_ONLY: 'answer_only',
  REVISE_PLAN: 'revise_plan',
  CLOSE_PLANNING: 'close_planning',
} as const;

export type DiscussionRoundResolution =
  (typeof ROUND_RESOLUTION)[keyof typeof ROUND_RESOLUTION];

export interface CommentMirrorRecord {
  owner: string;
  repo: string;
  issueNumber: number;
  commentId: number;
  authorLogin: string;
  authorType: 'human' | 'bot';
  body: string;
  createdAt: string;
  mirroredAt: string;
}

export interface PlanningThreadRecord {
  owner: string;
  repo: string;
  issueNumber: number;
  version: number;
  isClosed: boolean;
  currentPlanId?: string;
  openRoundId?: string;
  approvedPlanId?: string;
  lastProcessedCommentId?: number;
  updatedAt: string;
}

export interface PlanRevisionRecord {
  owner: string;
  repo: string;
  issueNumber: number;
  planId: string;
  version: number;
  basedOnPlanId?: string;
  status: PlanStatus;
  commentId: number;
  summary?: string;
  scope?: string;
  changes?: string;
  risks?: string;
  validation?: string;
  decisionLog?: string;
  changesSinceLastVersion?: string;
  body: string;
  createdAt: string;
}

export interface DiscussionRoundRecord {
  owner: string;
  repo: string;
  issueNumber: number;
  roundId: string;
  basedOnPlanId?: string;
  snapshotCommentIds: number[];
  snapshotLastSeenCommentId?: number;
  status: DiscussionRoundStatus;
  resolution?: DiscussionRoundResolution;
  producedPlanId?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface PlanningContextPayload {
  issueNumber: number;
  thread: PlanningThreadRecord | null;
  currentPlan: PlanRevisionRecord | null;
  openRound:
    | (DiscussionRoundRecord & { comments: CommentMirrorRecord[] })
    | null;
  pendingFeedbackCount: number;
  proposedPlan: {
    planId: string;
    version: number;
    basedOnPlanId?: string;
  } | null;
}

type AlongMetadata =
  | {
      kind: 'plan';
      planId: string;
      version: number;
      basedOnPlanId?: string;
      roundId?: string;
    }
  | {
      kind: 'planning-update';
      roundId: string;
      basedOnPlanId?: string;
    };

export interface ApprovalTarget {
  mode: 'implicit' | 'version' | 'planId';
  planId?: string;
  version?: number;
}

interface PlanSections {
  summary?: string;
  scope?: string;
  changes?: string;
  risks?: string;
  validation?: string;
  decisionLog?: string;
  changesSinceLastVersion?: string;
}

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function mapThreadRow(row: any): PlanningThreadRecord {
  return {
    owner: row.owner,
    repo: row.repo,
    issueNumber: row.issue_number,
    version: row.version,
    isClosed: Boolean(row.is_closed),
    currentPlanId: row.current_plan_id || undefined,
    openRoundId: row.open_round_id || undefined,
    approvedPlanId: row.approved_plan_id || undefined,
    lastProcessedCommentId: row.last_processed_comment_id || undefined,
    updatedAt: row.updated_at,
  };
}

function mapPlanRow(row: any): PlanRevisionRecord {
  return {
    owner: row.owner,
    repo: row.repo,
    issueNumber: row.issue_number,
    planId: row.plan_id,
    version: row.version,
    basedOnPlanId: row.based_on_plan_id || undefined,
    status: row.status,
    commentId: row.comment_id,
    summary: row.summary || undefined,
    scope: row.scope || undefined,
    changes: row.changes || undefined,
    risks: row.risks || undefined,
    validation: row.validation || undefined,
    decisionLog: row.decision_log || undefined,
    changesSinceLastVersion: row.changes_since_last_version || undefined,
    body: row.body || '',
    createdAt: row.created_at,
  };
}

function mapRoundRow(row: any): DiscussionRoundRecord {
  return {
    owner: row.owner,
    repo: row.repo,
    issueNumber: row.issue_number,
    roundId: row.round_id,
    basedOnPlanId: row.based_on_plan_id || undefined,
    snapshotCommentIds: row.snapshot_comment_ids
      ? JSON.parse(row.snapshot_comment_ids)
      : [],
    snapshotLastSeenCommentId: row.snapshot_last_seen_comment_id || undefined,
    status: row.status,
    resolution: row.resolution || undefined,
    producedPlanId: row.produced_plan_id || undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || undefined,
  };
}

function mapCommentRow(row: any): CommentMirrorRecord {
  return {
    owner: row.owner,
    repo: row.repo,
    issueNumber: row.issue_number,
    commentId: row.comment_id,
    authorLogin: row.author_login,
    authorType: row.author_type,
    body: row.body || '',
    createdAt: row.created_at,
    mirroredAt: row.mirrored_at,
  };
}

function extractSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const matches = [...body.matchAll(/^###\s+(.+?)\s*$/gm)];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const title = match[1].trim().toLowerCase();
    const start = (match.index || 0) + match[0].length;
    const end =
      i + 1 < matches.length
        ? matches[i + 1].index || body.length
        : body.length;
    sections[title] = body.slice(start, end).trim();
  }

  return sections;
}

function parsePlanSections(body: string): PlanSections {
  const sections = extractSections(body);
  const firstHeading = body.search(/^###\s+/m);
  const summary =
    firstHeading >= 0
      ? body
          .slice(0, firstHeading)
          .replace(/^<!--[\s\S]*?-->\s*/m, '')
          .trim()
      : body.replace(/^<!--[\s\S]*?-->\s*/m, '').trim();

  return {
    summary: summary || undefined,
    scope: sections.scope,
    changes: sections.changes,
    risks: sections.risks,
    validation: sections.validation,
    decisionLog: sections['decision log'],
    changesSinceLastVersion:
      sections['changes since v1'] ||
      sections['changes since last version'] ||
      sections['changes since previous version'],
  };
}

function parseAlongMetadata(body: string): AlongMetadata | null {
  const match = body.match(
    /<!--\s*along:(plan|planning-update)\s+(\{[\s\S]*?\})\s*-->/i,
  );
  if (!match) return null;

  try {
    const payload = JSON.parse(match[2]);
    if (match[1] === 'plan') {
      const planId = toOptionalString(payload.planId);
      const version = toOptionalNumber(payload.version);
      if (!planId || !version) return null;
      return {
        kind: 'plan',
        planId,
        version,
        basedOnPlanId: toOptionalString(payload.basedOnPlanId),
        roundId: toOptionalString(payload.roundId),
      };
    }

    const roundId = toOptionalString(payload.roundId);
    if (!roundId) return null;
    return {
      kind: 'planning-update',
      roundId,
      basedOnPlanId: toOptionalString(payload.basedOnPlanId),
    };
  } catch {
    return null;
  }
}

export function isSystemPlanningComment(body: string): boolean {
  return /<!--\s*along:(plan|planning-update)\b/i.test(body);
}

export function isApprovalCommand(body: string): boolean {
  return body.trim().toLowerCase().startsWith(COMMAND.APPROVE);
}

export function isRejectCommand(body: string): boolean {
  return body.trim().toLowerCase().startsWith(COMMAND.REJECT);
}

export function isHumanFeedbackComment(comment: CommentMirrorRecord): boolean {
  if (comment.authorType !== 'human') return false;
  const body = comment.body.trim();
  if (!body) return false;
  if (isSystemPlanningComment(body)) return false;
  if (isApprovalCommand(body)) return false;
  if (isRejectCommand(body)) return false;
  return true;
}

export function inferAuthorType(
  senderType?: string,
  authorLogin?: string,
  body?: string,
): 'human' | 'bot' {
  if (isSystemPlanningComment(body || '')) return 'bot';
  if ((senderType || '').toLowerCase() === 'bot') return 'bot';
  if ((authorLogin || '').toLowerCase().endsWith('[bot]')) return 'bot';
  return 'human';
}

export function parseApprovalCommand(body: string): ApprovalTarget | null {
  const trimmed = body.trim();
  if (!trimmed.toLowerCase().startsWith(COMMAND.APPROVE)) return null;

  const token = trimmed.slice(COMMAND.APPROVE.length).trim();
  if (!token) {
    return { mode: 'implicit' };
  }

  const versionMatch = token.match(/^v(\d+)$/i);
  if (versionMatch) {
    return { mode: 'version', version: Number(versionMatch[1]) };
  }

  const planIdMatch = token.match(/^plan:([a-z0-9_-]+)$/i);
  if (planIdMatch) {
    return { mode: 'planId', planId: planIdMatch[1] };
  }

  return null;
}

export function getPlanningThread(
  owner: string,
  repo: string,
  issueNumber: number,
): Result<PlanningThreadRecord | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const row = dbRes.data
      .prepare(
        'SELECT * FROM planning_threads WHERE owner = ? AND repo = ? AND issue_number = ?',
      )
      .get(owner, repo, issueNumber) as any;

    return success(row ? mapThreadRow(row) : null);
  } catch (error: any) {
    return failure(`读取 planning thread 失败: ${error.message}`);
  }
}

export function getPlanRevision(
  owner: string,
  repo: string,
  issueNumber: number,
  planId: string,
): Result<PlanRevisionRecord | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const row = dbRes.data
      .prepare(
        'SELECT * FROM plan_revisions WHERE owner = ? AND repo = ? AND issue_number = ? AND plan_id = ?',
      )
      .get(owner, repo, issueNumber, planId) as any;
    return success(row ? mapPlanRow(row) : null);
  } catch (error: any) {
    return failure(`读取 plan revision 失败: ${error.message}`);
  }
}

export function getCurrentPlanRevision(
  owner: string,
  repo: string,
  issueNumber: number,
): Result<PlanRevisionRecord | null> {
  const threadRes = getPlanningThread(owner, repo, issueNumber);
  if (!threadRes.success) return threadRes;
  if (!threadRes.data?.currentPlanId) return success(null);
  return getPlanRevision(
    owner,
    repo,
    issueNumber,
    threadRes.data.currentPlanId,
  );
}

export function getDiscussionRound(
  owner: string,
  repo: string,
  issueNumber: number,
  roundId: string,
): Result<DiscussionRoundRecord | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const row = dbRes.data
      .prepare(
        'SELECT * FROM discussion_rounds WHERE owner = ? AND repo = ? AND issue_number = ? AND round_id = ?',
      )
      .get(owner, repo, issueNumber, roundId) as any;
    return success(row ? mapRoundRow(row) : null);
  } catch (error: any) {
    return failure(`读取 discussion round 失败: ${error.message}`);
  }
}

export function getOpenDiscussionRound(
  owner: string,
  repo: string,
  issueNumber: number,
): Result<DiscussionRoundRecord | null> {
  const threadRes = getPlanningThread(owner, repo, issueNumber);
  if (!threadRes.success) return threadRes;
  if (!threadRes.data?.openRoundId) return success(null);
  return getDiscussionRound(
    owner,
    repo,
    issueNumber,
    threadRes.data.openRoundId,
  );
}

function getPlanRevisionByCommentId(
  owner: string,
  repo: string,
  issueNumber: number,
  commentId: number,
): Result<PlanRevisionRecord | null> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const row = dbRes.data
      .prepare(
        'SELECT * FROM plan_revisions WHERE owner = ? AND repo = ? AND issue_number = ? AND comment_id = ?',
      )
      .get(owner, repo, issueNumber, commentId) as any;
    return success(row ? mapPlanRow(row) : null);
  } catch (error: any) {
    return failure(`读取 plan revision 失败: ${error.message}`);
  }
}

function formatCurrentPlanLabel(
  thread: PlanningThreadRecord | null,
  currentPlan: PlanRevisionRecord | null,
): string {
  if (!thread?.currentPlanId || !currentPlan) {
    return thread?.currentPlanId ? thread.currentPlanId : 'none';
  }
  return `Plan v${currentPlan.version} (${currentPlan.planId})`;
}

export function listCommentMirrors(
  owner: string,
  repo: string,
  issueNumber: number,
): Result<CommentMirrorRecord[]> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const rows = dbRes.data
      .prepare(
        'SELECT * FROM comment_mirror WHERE owner = ? AND repo = ? AND issue_number = ? ORDER BY comment_id ASC',
      )
      .all(owner, repo, issueNumber) as any[];
    return success(rows.map(mapCommentRow));
  } catch (error: any) {
    return failure(`读取评论镜像失败: ${error.message}`);
  }
}

function computePendingFeedback(
  comments: CommentMirrorRecord[],
  thread: PlanningThreadRecord | null,
  currentPlan: PlanRevisionRecord | null,
  beforeCommentId?: number,
): CommentMirrorRecord[] {
  const minCommentId = Math.max(
    thread?.lastProcessedCommentId || 0,
    currentPlan?.commentId || 0,
  );

  return comments.filter((comment) => {
    if (!isHumanFeedbackComment(comment)) return false;
    if (comment.commentId <= minCommentId) return false;
    if (beforeCommentId && comment.commentId >= beforeCommentId) return false;
    return true;
  });
}

export function getPendingHumanFeedback(
  owner: string,
  repo: string,
  issueNumber: number,
  beforeCommentId?: number,
): Result<CommentMirrorRecord[]> {
  const commentsRes = listCommentMirrors(owner, repo, issueNumber);
  if (!commentsRes.success) return commentsRes;

  const threadRes = getPlanningThread(owner, repo, issueNumber);
  if (!threadRes.success) return threadRes;

  const planRes = getCurrentPlanRevision(owner, repo, issueNumber);
  if (!planRes.success) return planRes;

  return success(
    computePendingFeedback(
      commentsRes.data,
      threadRes.data,
      planRes.data,
      beforeCommentId,
    ),
  );
}

function ensureThreadRow(
  owner: string,
  repo: string,
  issueNumber: number,
): Result<void> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const now = iso_timestamp();
    dbRes.data
      .prepare(
        `
          INSERT INTO planning_threads (
            owner, repo, issue_number, version, is_closed, updated_at
          ) VALUES (?, ?, ?, 1, 0, ?)
          ON CONFLICT(owner, repo, issue_number) DO NOTHING
        `,
      )
      .run(owner, repo, issueNumber, now);
    return success(undefined);
  } catch (error: any) {
    return failure(`初始化 planning thread 失败: ${error.message}`);
  }
}

export function mirrorIssueComment(input: {
  owner: string;
  repo: string;
  issueNumber: number;
  commentId: number;
  authorLogin: string;
  senderType?: string;
  body: string;
  createdAt?: string;
}): Result<CommentMirrorRecord> {
  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  const authorType = inferAuthorType(
    input.senderType,
    input.authorLogin,
    input.body,
  );
  const createdAt = input.createdAt || iso_timestamp();
  const mirroredAt = iso_timestamp();

  try {
    dbRes.data
      .prepare(
        `
          INSERT INTO comment_mirror (
            owner, repo, issue_number, comment_id, author_login, author_type, body, created_at, mirrored_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(comment_id) DO UPDATE SET
            author_login = excluded.author_login,
            author_type = excluded.author_type,
            body = excluded.body,
            created_at = excluded.created_at,
            mirrored_at = excluded.mirrored_at
        `,
      )
      .run(
        input.owner,
        input.repo,
        input.issueNumber,
        input.commentId,
        input.authorLogin,
        authorType,
        input.body,
        createdAt,
        mirroredAt,
      );

    ensureThreadRow(input.owner, input.repo, input.issueNumber);

    return success({
      owner: input.owner,
      repo: input.repo,
      issueNumber: input.issueNumber,
      commentId: input.commentId,
      authorLogin: input.authorLogin,
      authorType,
      body: input.body,
      createdAt,
      mirroredAt,
    });
  } catch (error: any) {
    return failure(`镜像 issue comment 失败: ${error.message}`);
  }
}

function createOpenRoundFromComments(
  owner: string,
  repo: string,
  issueNumber: number,
  basedOnPlanId: string,
  comments: CommentMirrorRecord[],
): Result<DiscussionRoundRecord | null> {
  if (comments.length === 0) return success(null);

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  const threadRes = getPlanningThread(owner, repo, issueNumber);
  if (!threadRes.success) return threadRes;
  if (!threadRes.data) return failure('planning thread 不存在');

  try {
    const roundId = generateId('round');
    const createdAt = iso_timestamp();
    const snapshotCommentIds = comments.map((comment) => comment.commentId);
    const snapshotLastSeenCommentId =
      snapshotCommentIds[snapshotCommentIds.length - 1];

    const txn = dbRes.data.transaction(() => {
      dbRes.data
        .prepare(
          `
            INSERT INTO discussion_rounds (
              owner, repo, issue_number, round_id, based_on_plan_id, snapshot_comment_ids,
              snapshot_last_seen_comment_id, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          owner,
          repo,
          issueNumber,
          roundId,
          basedOnPlanId,
          JSON.stringify(snapshotCommentIds),
          snapshotLastSeenCommentId,
          ROUND_STATUS.OPEN,
          createdAt,
        );

      const updateRes = dbRes.data
        .prepare(
          `
            UPDATE planning_threads
            SET version = version + 1,
                open_round_id = ?,
                approved_plan_id = NULL,
                updated_at = ?
            WHERE owner = ? AND repo = ? AND issue_number = ?
          `,
        )
        .run(roundId, createdAt, owner, repo, issueNumber);

      if ((updateRes as any).changes === 0) {
        throw new Error('更新 planning thread 失败');
      }
    });

    txn();

    return success({
      owner,
      repo,
      issueNumber,
      roundId,
      basedOnPlanId,
      snapshotCommentIds,
      snapshotLastSeenCommentId,
      status: ROUND_STATUS.OPEN,
      createdAt,
    });
  } catch (error: any) {
    return failure(`创建 discussion round 失败: ${error.message}`);
  }
}

export function ensureOpenDiscussionRound(
  owner: string,
  repo: string,
  issueNumber: number,
): Result<DiscussionRoundRecord | null> {
  const threadRes = getPlanningThread(owner, repo, issueNumber);
  if (!threadRes.success) return threadRes;
  const thread = threadRes.data;
  if (!thread?.currentPlanId) return success(null);

  const openRoundRes = getOpenDiscussionRound(owner, repo, issueNumber);
  if (!openRoundRes.success) return openRoundRes;
  if (openRoundRes.data) return success(openRoundRes.data);

  const pendingRes = getPendingHumanFeedback(owner, repo, issueNumber);
  if (!pendingRes.success) return pendingRes;

  return createOpenRoundFromComments(
    owner,
    repo,
    issueNumber,
    thread.currentPlanId,
    pendingRes.data,
  );
}

export function preparePlanningExecution(
  owner: string,
  repo: string,
  issueNumber: number,
): Result<PlanningContextPayload> {
  logger.info(`preparePlanningExecution 开始 (Issue #${issueNumber})`);

  const threadRes = getPlanningThread(owner, repo, issueNumber);
  if (!threadRes.success) return threadRes;

  logger.info(
    `Issue #${issueNumber} thread 状态: currentPlanId=${threadRes.data?.currentPlanId || '无'}, openRoundId=${threadRes.data?.openRoundId || '无'}`,
  );

  const currentPlanRes = getCurrentPlanRevision(owner, repo, issueNumber);
  if (!currentPlanRes.success) return currentPlanRes;

  logger.info(
    `Issue #${issueNumber} 当前 plan: ${currentPlanRes.data ? `version=${currentPlanRes.data.version}, planId=${currentPlanRes.data.planId}` : '无'}`,
  );

  let openRound: DiscussionRoundRecord | null = null;
  if (threadRes.data?.openRoundId) {
    const roundRes = getDiscussionRound(
      owner,
      repo,
      issueNumber,
      threadRes.data.openRoundId,
    );
    if (!roundRes.success) return roundRes;
    openRound = roundRes.data;
  }

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  if (openRound && openRound.status !== ROUND_STATUS.PROCESSING) {
    try {
      dbRes.data
        .prepare(
          `
            UPDATE discussion_rounds
            SET status = ?
            WHERE owner = ? AND repo = ? AND issue_number = ? AND round_id = ?
          `,
        )
        .run(
          ROUND_STATUS.PROCESSING,
          owner,
          repo,
          issueNumber,
          openRound.roundId,
        );
      openRound = {
        ...openRound,
        status: ROUND_STATUS.PROCESSING,
      };
    } catch (error: any) {
      return failure(`更新 discussion round 状态失败: ${error.message}`);
    }
  }

  const commentsRes = listCommentMirrors(owner, repo, issueNumber);
  if (!commentsRes.success) return commentsRes;
  const commentIndex = new Map(
    commentsRes.data.map((comment) => [comment.commentId, comment]),
  );
  const roundComments = openRound
    ? openRound.snapshotCommentIds
        .map((commentId) => commentIndex.get(commentId))
        .filter((comment): comment is CommentMirrorRecord => Boolean(comment))
    : [];

  const payload: PlanningContextPayload = {
    issueNumber,
    thread: threadRes.data,
    currentPlan: currentPlanRes.data,
    openRound: openRound
      ? {
          ...openRound,
          comments: roundComments,
        }
      : null,
    pendingFeedbackCount: computePendingFeedback(
      commentsRes.data,
      threadRes.data,
      currentPlanRes.data,
    ).length,
    proposedPlan: {
      planId: generateId('plan'),
      version: (currentPlanRes.data?.version || 0) + 1,
      basedOnPlanId: currentPlanRes.data?.planId,
    },
  };

  logger.info(
    `Issue #${issueNumber} 生成新 plan: planId=${payload.proposedPlan?.planId}, version=${payload.proposedPlan?.version}, basedOn=${payload.proposedPlan?.basedOnPlanId || '无'}`,
  );

  return success(payload);
}

export function writePlanningContextFile(
  paths: SessionPathManager,
  payload: PlanningContextPayload,
): Result<string> {
  const ensureRes = paths.ensureDir();
  if (!ensureRes.success) return ensureRes;

  const filePath = paths.getPlanningContextFile();

  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    return success(filePath);
  } catch (error: any) {
    return failure(`写入 planning-context.json 失败: ${error.message}`);
  }
}

function upsertPlanRevision(
  owner: string,
  repo: string,
  issueNumber: number,
  metadata: Extract<AlongMetadata, { kind: 'plan' }>,
  commentId: number,
  body: string,
  createdAt: string,
): void {
  const dbRes = getDb();
  if (!dbRes.success) {
    throw new Error(dbRes.error);
  }

  const sections = parsePlanSections(body);
  const db = dbRes.data;

  db.prepare(
    `
      UPDATE plan_revisions
      SET status = ?
      WHERE owner = ? AND repo = ? AND issue_number = ? AND plan_id != ? AND status = ?
    `,
  ).run(
    PLAN_STATUS.SUPERSEDED,
    owner,
    repo,
    issueNumber,
    metadata.planId,
    PLAN_STATUS.ACTIVE,
  );

  db.prepare(
    `
      INSERT INTO plan_revisions (
        owner, repo, issue_number, plan_id, version, based_on_plan_id, status, comment_id,
        summary, scope, changes, risks, validation, decision_log, changes_since_last_version,
        body, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plan_id) DO UPDATE SET
        version = excluded.version,
        based_on_plan_id = excluded.based_on_plan_id,
        status = excluded.status,
        comment_id = excluded.comment_id,
        summary = excluded.summary,
        scope = excluded.scope,
        changes = excluded.changes,
        risks = excluded.risks,
        validation = excluded.validation,
        decision_log = excluded.decision_log,
        changes_since_last_version = excluded.changes_since_last_version,
        body = excluded.body,
        created_at = excluded.created_at
    `,
  ).run(
    owner,
    repo,
    issueNumber,
    metadata.planId,
    metadata.version,
    metadata.basedOnPlanId || null,
    PLAN_STATUS.ACTIVE,
    commentId,
    sections.summary || null,
    sections.scope || null,
    sections.changes || null,
    sections.risks || null,
    sections.validation || null,
    sections.decisionLog || null,
    sections.changesSinceLastVersion || null,
    body,
    createdAt,
  );
}

function resolveRoundAfterAgentComment(
  owner: string,
  repo: string,
  issueNumber: number,
  roundId: string,
  resolution: DiscussionRoundResolution,
  producedPlanId?: string,
): void {
  const dbRes = getDb();
  if (!dbRes.success) {
    throw new Error(dbRes.error);
  }
  const db = dbRes.data;

  const roundRow = db
    .prepare(
      'SELECT * FROM discussion_rounds WHERE owner = ? AND repo = ? AND issue_number = ? AND round_id = ?',
    )
    .get(owner, repo, issueNumber, roundId) as any;
  if (!roundRow) return;

  const round = mapRoundRow(roundRow);
  const threadRow = db
    .prepare(
      'SELECT * FROM planning_threads WHERE owner = ? AND repo = ? AND issue_number = ?',
    )
    .get(owner, repo, issueNumber) as any;
  const thread = threadRow ? mapThreadRow(threadRow) : null;

  const currentPlanRow = thread?.currentPlanId
    ? db
        .prepare(
          'SELECT * FROM plan_revisions WHERE owner = ? AND repo = ? AND issue_number = ? AND plan_id = ?',
        )
        .get(owner, repo, issueNumber, thread.currentPlanId)
    : null;
  const currentPlan = currentPlanRow ? mapPlanRow(currentPlanRow) : null;

  const commentRows = db
    .prepare(
      'SELECT * FROM comment_mirror WHERE owner = ? AND repo = ? AND issue_number = ? ORDER BY comment_id ASC',
    )
    .all(owner, repo, issueNumber) as any[];
  const comments = commentRows.map(mapCommentRow);
  const pendingAfterSnapshot = computePendingFeedback(
    comments,
    thread,
    currentPlan,
  ).filter(
    (comment) =>
      !round.snapshotLastSeenCommentId ||
      comment.commentId > round.snapshotLastSeenCommentId,
  );

  const now = iso_timestamp();
  const nextLastProcessed = Math.max(
    thread?.lastProcessedCommentId || 0,
    round.snapshotLastSeenCommentId || 0,
  );

  db.prepare(
    `
      UPDATE discussion_rounds
      SET status = ?, resolution = ?, produced_plan_id = ?, resolved_at = ?
      WHERE owner = ? AND repo = ? AND issue_number = ? AND round_id = ?
    `,
  ).run(
    pendingAfterSnapshot.length > 0
      ? ROUND_STATUS.STALE_PARTIAL
      : ROUND_STATUS.RESOLVED,
    resolution,
    producedPlanId || null,
    now,
    owner,
    repo,
    issueNumber,
    roundId,
  );

  if (pendingAfterSnapshot.length > 0) {
    const nextRoundId = generateId('round');
    const snapshotCommentIds = pendingAfterSnapshot.map(
      (comment) => comment.commentId,
    );
    const snapshotLastSeenCommentId =
      snapshotCommentIds[snapshotCommentIds.length - 1];

    db.prepare(
      `
        INSERT INTO discussion_rounds (
          owner, repo, issue_number, round_id, based_on_plan_id, snapshot_comment_ids,
          snapshot_last_seen_comment_id, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      owner,
      repo,
      issueNumber,
      nextRoundId,
      currentPlan?.planId || producedPlanId || round.basedOnPlanId || null,
      JSON.stringify(snapshotCommentIds),
      snapshotLastSeenCommentId,
      ROUND_STATUS.OPEN,
      now,
    );

    db.prepare(
      `
        UPDATE planning_threads
        SET version = version + 1,
            open_round_id = ?,
            approved_plan_id = NULL,
            last_processed_comment_id = ?,
            updated_at = ?
        WHERE owner = ? AND repo = ? AND issue_number = ?
      `,
    ).run(
      nextRoundId,
      nextLastProcessed || null,
      now,
      owner,
      repo,
      issueNumber,
    );
  } else {
    db.prepare(
      `
        UPDATE planning_threads
        SET version = version + 1,
            open_round_id = NULL,
            last_processed_comment_id = ?,
            updated_at = ?
        WHERE owner = ? AND repo = ? AND issue_number = ?
      `,
    ).run(nextLastProcessed || null, now, owner, repo, issueNumber);
  }
}

function classifyPlanningAgentComment(
  owner: string,
  repo: string,
  issueNumber: number,
  metadata: AlongMetadata,
  commentId: number,
): Result<'apply' | 'replay' | 'ignore'> {
  if (metadata.kind === 'plan') {
    const existingPlanRes = getPlanRevisionByCommentId(
      owner,
      repo,
      issueNumber,
      commentId,
    );
    if (!existingPlanRes.success) return existingPlanRes;
    if (existingPlanRes.data?.planId === metadata.planId) {
      return success('replay');
    }
  }

  if (!('roundId' in metadata) || !metadata.roundId) {
    return success('apply');
  }

  const roundRes = getDiscussionRound(
    owner,
    repo,
    issueNumber,
    metadata.roundId,
  );
  if (!roundRes.success) return roundRes;
  const round = roundRes.data;
  if (!round) return success('apply');

  if (metadata.kind === 'plan') {
    if (round.producedPlanId) {
      return success(
        round.producedPlanId === metadata.planId ? 'replay' : 'ignore',
      );
    }

    if (
      round.status !== ROUND_STATUS.OPEN &&
      round.status !== ROUND_STATUS.PROCESSING
    ) {
      return success('ignore');
    }

    return success('apply');
  }

  if (
    round.status !== ROUND_STATUS.OPEN &&
    round.status !== ROUND_STATUS.PROCESSING
  ) {
    return success(
      round.resolution === ROUND_RESOLUTION.ANSWER_ONLY ? 'replay' : 'ignore',
    );
  }

  return success('apply');
}

export function recordPlanningAgentComment(input: {
  owner: string;
  repo: string;
  issueNumber: number;
  commentId: number;
  body: string;
  createdAt?: string;
}): Result<'plan' | 'planning-update' | 'ignored'> {
  const metadata = parseAlongMetadata(input.body);
  if (!metadata) return success('ignored');

  const classifyRes = classifyPlanningAgentComment(
    input.owner,
    input.repo,
    input.issueNumber,
    metadata,
    input.commentId,
  );
  if (!classifyRes.success) return classifyRes;
  if (classifyRes.data === 'ignore') return success('ignored');
  if (classifyRes.data === 'replay') {
    return success(metadata.kind === 'plan' ? 'plan' : 'planning-update');
  }

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;
  const createdAt = input.createdAt || iso_timestamp();

  try {
    const txn = dbRes.data.transaction(() => {
      ensureThreadRow(input.owner, input.repo, input.issueNumber);

      if (metadata.kind === 'plan') {
        upsertPlanRevision(
          input.owner,
          input.repo,
          input.issueNumber,
          metadata,
          input.commentId,
          input.body,
          createdAt,
        );

        dbRes.data
          .prepare(
            `
              UPDATE planning_threads
              SET version = version + 1,
                  current_plan_id = ?,
                  approved_plan_id = NULL,
                  updated_at = ?
              WHERE owner = ? AND repo = ? AND issue_number = ?
            `,
          )
          .run(
            metadata.planId,
            createdAt,
            input.owner,
            input.repo,
            input.issueNumber,
          );

        if (metadata.roundId) {
          resolveRoundAfterAgentComment(
            input.owner,
            input.repo,
            input.issueNumber,
            metadata.roundId,
            ROUND_RESOLUTION.REVISE_PLAN,
            metadata.planId,
          );
        }
        return;
      }

      resolveRoundAfterAgentComment(
        input.owner,
        input.repo,
        input.issueNumber,
        metadata.roundId,
        ROUND_RESOLUTION.ANSWER_ONLY,
      );
    });

    txn();

    return success(metadata.kind === 'plan' ? 'plan' : 'planning-update');
  } catch (error: any) {
    return failure(`记录 planning agent comment 失败: ${error.message}`);
  }
}

export function shouldContinuePlanning(
  owner: string,
  repo: string,
  issueNumber: number,
): Result<boolean> {
  const openRoundRes = ensureOpenDiscussionRound(owner, repo, issueNumber);
  if (!openRoundRes.success) return openRoundRes;
  return success(Boolean(openRoundRes.data));
}

export function approvePlan(
  owner: string,
  repo: string,
  issueNumber: number,
  target: ApprovalTarget,
  approvalCommentId: number,
): Result<PlanRevisionRecord> {
  const threadRes = getPlanningThread(owner, repo, issueNumber);
  if (!threadRes.success) return threadRes;
  const thread = threadRes.data;
  if (!thread?.currentPlanId) {
    return failure('当前没有可批准的正式计划');
  }

  if (thread.openRoundId) {
    const currentPlanRes = getCurrentPlanRevision(owner, repo, issueNumber);
    if (!currentPlanRes.success) return currentPlanRes;
    return failure(
      `当前仍有待处理的讨论轮次（round=${thread.openRoundId}，currentPlan=${formatCurrentPlanLabel(thread, currentPlanRes.data)}），不能批准`,
    );
  }

  let planId = thread.currentPlanId;
  if (target.mode === 'version') {
    const dbRes = getDb();
    if (!dbRes.success) return dbRes;
    const row = dbRes.data
      .prepare(
        'SELECT * FROM plan_revisions WHERE owner = ? AND repo = ? AND issue_number = ? AND version = ?',
      )
      .get(owner, repo, issueNumber, target.version) as any;
    if (!row) return failure(`未找到 Plan v${target.version}`);
    planId = row.plan_id;
  } else if (target.mode === 'planId') {
    if (!target.planId) return failure('缺少 planId，无法批准计划');
    planId = target.planId;
  }

  if (planId !== thread.currentPlanId) {
    return failure('只能批准当前有效正式计划');
  }

  const pendingRes = getPendingHumanFeedback(
    owner,
    repo,
    issueNumber,
    approvalCommentId,
  );
  if (!pendingRes.success) return pendingRes;
  if (pendingRes.data.length > 0) {
    return failure('存在未处理的人类反馈，不能批准');
  }

  const dbRes = getDb();
  if (!dbRes.success) return dbRes;

  try {
    const approvedAt = iso_timestamp();
    const txn = dbRes.data.transaction(() => {
      dbRes.data
        .prepare(
          `
            UPDATE plan_revisions
            SET status = ?
            WHERE owner = ? AND repo = ? AND issue_number = ? AND plan_id = ?
          `,
        )
        .run(PLAN_STATUS.APPROVED, owner, repo, issueNumber, planId);

      dbRes.data
        .prepare(
          `
            UPDATE planning_threads
            SET version = version + 1,
                approved_plan_id = ?,
                updated_at = ?
            WHERE owner = ? AND repo = ? AND issue_number = ?
          `,
        )
        .run(planId, approvedAt, owner, repo, issueNumber);
    });

    txn();

    const planRes = getPlanRevision(owner, repo, issueNumber, planId);
    if (!planRes.success || !planRes.data) {
      return failure('批准后读取计划失败');
    }
    return success(planRes.data);
  } catch (error: any) {
    return failure(`批准计划失败: ${error.message}`);
  }
}

export function collectPlanningContext(
  owner: string,
  repo: string,
  issueNumber: number,
): Result<PlanningContextPayload> {
  const payloadRes = preparePlanningExecution(owner, repo, issueNumber);
  if (!payloadRes.success) return payloadRes;
  return success(payloadRes.data);
}
