import { beforeEach, describe, expect, it, vi } from 'vitest';

type ThreadRow = any;
type PlanRow = any;
type RoundRow = any;
type CommentRow = any;

const state: {
  threads: ThreadRow[];
  plans: PlanRow[];
  rounds: RoundRow[];
  comments: CommentRow[];
} = {
  threads: [],
  plans: [],
  rounds: [],
  comments: [],
};

function resetState() {
  state.threads = [];
  state.plans = [];
  state.rounds = [];
  state.comments = [];
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function findThread(
  owner: string,
  repo: string,
  issueNumber: number,
): ThreadRow | undefined {
  return state.threads.find(
    (row) =>
      row.owner === owner &&
      row.repo === repo &&
      row.issue_number === issueNumber,
  );
}

function makeStmt(sql: string) {
  const normalized = normalizeSql(sql);

  return {
    get: (...args: any[]) => {
      if (normalized.includes('FROM planning_threads')) {
        const [owner, repo, issueNumber] = args;
        return findThread(owner, repo, issueNumber) || null;
      }

      if (
        normalized.includes('FROM plan_revisions') &&
        normalized.includes('AND plan_id = ?')
      ) {
        const [owner, repo, issueNumber, planId] = args;
        return (
          state.plans.find(
            (row) =>
              row.owner === owner &&
              row.repo === repo &&
              row.issue_number === issueNumber &&
              row.plan_id === planId,
          ) || null
        );
      }

      if (
        normalized.includes('FROM plan_revisions') &&
        normalized.includes('AND version = ?')
      ) {
        const [owner, repo, issueNumber, version] = args;
        return (
          state.plans.find(
            (row) =>
              row.owner === owner &&
              row.repo === repo &&
              row.issue_number === issueNumber &&
              row.version === version,
          ) || null
        );
      }

      if (
        normalized.includes('FROM plan_revisions') &&
        normalized.includes('AND comment_id = ?')
      ) {
        const [owner, repo, issueNumber, commentId] = args;
        return (
          state.plans.find(
            (row) =>
              row.owner === owner &&
              row.repo === repo &&
              row.issue_number === issueNumber &&
              row.comment_id === commentId,
          ) || null
        );
      }

      if (normalized.includes('FROM discussion_rounds')) {
        const [owner, repo, issueNumber, roundId] = args;
        return (
          state.rounds.find(
            (row) =>
              row.owner === owner &&
              row.repo === repo &&
              row.issue_number === issueNumber &&
              row.round_id === roundId,
          ) || null
        );
      }

      return null;
    },
    all: (...args: any[]) => {
      if (normalized.includes('FROM comment_mirror')) {
        const [owner, repo, issueNumber] = args;
        return state.comments
          .filter(
            (row) =>
              row.owner === owner &&
              row.repo === repo &&
              row.issue_number === issueNumber,
          )
          .sort((a, b) => a.comment_id - b.comment_id);
      }

      return [];
    },
    run: (...args: any[]) => {
      if (normalized.startsWith('INSERT INTO planning_threads')) {
        const [owner, repo, issueNumber, updatedAt] = args;
        if (!findThread(owner, repo, issueNumber)) {
          state.threads.push({
            owner,
            repo,
            issue_number: issueNumber,
            version: 1,
            is_closed: 0,
            current_plan_id: null,
            open_round_id: null,
            approved_plan_id: null,
            last_processed_comment_id: null,
            updated_at: updatedAt,
          });
        }
        return { changes: 1 };
      }

      if (normalized.startsWith('INSERT INTO comment_mirror')) {
        const [
          owner,
          repo,
          issueNumber,
          commentId,
          authorLogin,
          authorType,
          body,
          createdAt,
          mirroredAt,
        ] = args;
        const existing = state.comments.find(
          (row) => row.comment_id === commentId,
        );
        const next = {
          owner,
          repo,
          issue_number: issueNumber,
          comment_id: commentId,
          author_login: authorLogin,
          author_type: authorType,
          body,
          created_at: createdAt,
          mirrored_at: mirroredAt,
        };
        if (existing) {
          Object.assign(existing, next);
        } else {
          state.comments.push(next);
        }
        return { changes: 1 };
      }

      if (normalized.startsWith('INSERT INTO plan_revisions')) {
        const [
          owner,
          repo,
          issueNumber,
          planId,
          version,
          basedOnPlanId,
          status,
          commentId,
          summary,
          scope,
          changes,
          risks,
          validation,
          decisionLog,
          changesSinceLastVersion,
          body,
          createdAt,
        ] = args;
        const existing = state.plans.find((row) => row.plan_id === planId);
        const next = {
          owner,
          repo,
          issue_number: issueNumber,
          plan_id: planId,
          version,
          based_on_plan_id: basedOnPlanId,
          status,
          comment_id: commentId,
          summary,
          scope,
          changes,
          risks,
          validation,
          decision_log: decisionLog,
          changes_since_last_version: changesSinceLastVersion,
          body,
          created_at: createdAt,
        };
        if (existing) {
          Object.assign(existing, next);
        } else {
          state.plans.push(next);
        }
        return { changes: 1 };
      }

      if (
        normalized.startsWith(
          'UPDATE plan_revisions SET status = ? WHERE owner = ? AND repo = ? AND issue_number = ? AND plan_id != ?',
        )
      ) {
        const [status, owner, repo, issueNumber, planId, fromStatus] = args;
        for (const row of state.plans) {
          if (
            row.owner === owner &&
            row.repo === repo &&
            row.issue_number === issueNumber &&
            row.plan_id !== planId &&
            row.status === fromStatus
          ) {
            row.status = status;
          }
        }
        return { changes: 1 };
      }

      if (
        normalized.startsWith(
          'UPDATE plan_revisions SET status = ? WHERE owner = ? AND repo = ? AND issue_number = ? AND plan_id = ?',
        )
      ) {
        const [status, owner, repo, issueNumber, planId] = args;
        const row = state.plans.find(
          (item) =>
            item.owner === owner &&
            item.repo === repo &&
            item.issue_number === issueNumber &&
            item.plan_id === planId,
        );
        if (row) row.status = status;
        return { changes: row ? 1 : 0 };
      }

      if (
        normalized.startsWith(
          'UPDATE planning_threads SET version = version + 1, current_plan_id = ?, approved_plan_id = NULL, updated_at = ?',
        )
      ) {
        const [planId, updatedAt, owner, repo, issueNumber] = args;
        const row = findThread(owner, repo, issueNumber);
        if (!row) return { changes: 0 };
        row.version += 1;
        row.current_plan_id = planId;
        row.approved_plan_id = null;
        row.updated_at = updatedAt;
        return { changes: 1 };
      }

      if (
        normalized.startsWith(
          'UPDATE planning_threads SET version = version + 1, open_round_id = NULL, last_processed_comment_id = ?, updated_at = ?',
        )
      ) {
        const [lastProcessedCommentId, updatedAt, owner, repo, issueNumber] =
          args;
        const row = findThread(owner, repo, issueNumber);
        if (!row) return { changes: 0 };
        row.version += 1;
        row.open_round_id = null;
        row.last_processed_comment_id = lastProcessedCommentId;
        row.updated_at = updatedAt;
        return { changes: 1 };
      }

      if (
        normalized.startsWith(
          'UPDATE planning_threads SET version = version + 1, open_round_id = ?, approved_plan_id = NULL, last_processed_comment_id = ?, updated_at = ?',
        )
      ) {
        const [
          roundId,
          lastProcessedCommentId,
          updatedAt,
          owner,
          repo,
          issueNumber,
        ] = args;
        const row = findThread(owner, repo, issueNumber);
        if (!row) return { changes: 0 };
        row.version += 1;
        row.open_round_id = roundId;
        row.approved_plan_id = null;
        row.last_processed_comment_id = lastProcessedCommentId;
        row.updated_at = updatedAt;
        return { changes: 1 };
      }

      if (
        normalized.startsWith(
          'UPDATE planning_threads SET version = version + 1, approved_plan_id = ?, updated_at = ?',
        )
      ) {
        const [planId, updatedAt, owner, repo, issueNumber] = args;
        const row = findThread(owner, repo, issueNumber);
        if (!row) return { changes: 0 };
        row.version += 1;
        row.approved_plan_id = planId;
        row.updated_at = updatedAt;
        return { changes: 1 };
      }

      if (
        normalized.startsWith(
          'UPDATE discussion_rounds SET status = ?, resolution = ?, produced_plan_id = ?, resolved_at = ?',
        )
      ) {
        const [
          status,
          resolution,
          producedPlanId,
          resolvedAt,
          owner,
          repo,
          issueNumber,
          roundId,
        ] = args;
        const row = state.rounds.find(
          (item) =>
            item.owner === owner &&
            item.repo === repo &&
            item.issue_number === issueNumber &&
            item.round_id === roundId,
        );
        if (!row) return { changes: 0 };
        row.status = status;
        row.resolution = resolution;
        row.produced_plan_id = producedPlanId;
        row.resolved_at = resolvedAt;
        return { changes: 1 };
      }

      if (normalized.startsWith('INSERT INTO discussion_rounds')) {
        const [
          owner,
          repo,
          issueNumber,
          roundId,
          basedOnPlanId,
          snapshotCommentIds,
          snapshotLastSeenCommentId,
          status,
          createdAt,
        ] = args;
        state.rounds.push({
          owner,
          repo,
          issue_number: issueNumber,
          round_id: roundId,
          based_on_plan_id: basedOnPlanId,
          snapshot_comment_ids: snapshotCommentIds,
          snapshot_last_seen_comment_id: snapshotLastSeenCommentId,
          status,
          resolution: null,
          produced_plan_id: null,
          created_at: createdAt,
          resolved_at: null,
        });
        return { changes: 1 };
      }

      return { changes: 0 };
    },
  };
}

const mockDbInstance = {
  exec: vi.fn(),
  prepare: vi.fn((sql: string) => makeStmt(sql)),
  close: vi.fn(),
  transaction: vi.fn((fn: () => void) => fn),
};

vi.mock('bun:sqlite', () => {
  return {
    Database: vi.fn(function Database() {
      return mockDbInstance;
    }),
  };
});

import { closeDb } from '../core/db';
import {
  approvePlan,
  type CommentMirrorRecord,
  inferAuthorType,
  isHumanFeedbackComment,
  isSystemPlanningComment,
  parseApprovalCommand,
  recordPlanningAgentComment,
} from './planning-state';

function createComment(body: string): CommentMirrorRecord {
  return {
    owner: 'o',
    repo: 'r',
    issueNumber: 1,
    commentId: 1,
    authorLogin: 'alice',
    authorType: 'human',
    body,
    createdAt: '2026-04-20T12:00:00.000Z',
    mirroredAt: '2026-04-20T12:00:01.000Z',
  };
}

describe('planning-state.ts', () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
    mockDbInstance.prepare.mockImplementation((sql: string) => makeStmt(sql));
    mockDbInstance.transaction.mockImplementation((fn: () => void) => fn);
    closeDb();
  });

  it('识别系统 planning 评论元数据', () => {
    const body =
      '<!-- along:plan {"planId":"plan_123","version":1} -->\n## Plan v1';

    expect(isSystemPlanningComment(body)).toBe(true);
    expect(inferAuthorType('User', 'alice', body)).toBe('bot');
    expect(isHumanFeedbackComment(createComment(body))).toBe(false);
  });

  it('只将普通人类评论视为 feedback', () => {
    expect(
      isHumanFeedbackComment(createComment('前端不要轮询，接口失败要重试')),
    ).toBe(true);
    expect(isHumanFeedbackComment(createComment('/approve v2'))).toBe(false);
    expect(isHumanFeedbackComment(createComment('/reject'))).toBe(false);
  });

  it('解析 approve 指令目标', () => {
    expect(parseApprovalCommand('/approve')).toEqual({ mode: 'implicit' });
    expect(parseApprovalCommand('/approve v2')).toEqual({
      mode: 'version',
      version: 2,
    });
    expect(parseApprovalCommand('/approve plan:plan_abc123')).toEqual({
      mode: 'planId',
      planId: 'plan_abc123',
    });
    expect(parseApprovalCommand('/approve latest')).toBeNull();
  });

  it('重复处理同一 round 的同一计划评论时保持幂等', () => {
    state.threads.push({
      owner: 'o',
      repo: 'r',
      issue_number: 1,
      version: 3,
      is_closed: 0,
      current_plan_id: 'plan_v2',
      open_round_id: null,
      approved_plan_id: null,
      last_processed_comment_id: 1,
      updated_at: '2026-04-20T12:05:00.000Z',
    });
    state.plans.push({
      owner: 'o',
      repo: 'r',
      issue_number: 1,
      plan_id: 'plan_v2',
      version: 2,
      based_on_plan_id: 'plan_v1',
      status: 'active',
      comment_id: 10,
      summary: 'Plan v2',
      scope: null,
      changes: null,
      risks: null,
      validation: null,
      decision_log: null,
      changes_since_last_version: null,
      body: 'body',
      created_at: '2026-04-20T12:04:00.000Z',
    });
    state.rounds.push({
      owner: 'o',
      repo: 'r',
      issue_number: 1,
      round_id: 'round_1',
      based_on_plan_id: 'plan_v1',
      snapshot_comment_ids: '[1]',
      snapshot_last_seen_comment_id: 1,
      status: 'resolved',
      resolution: 'revise_plan',
      produced_plan_id: 'plan_v2',
      created_at: '2026-04-20T12:03:00.000Z',
      resolved_at: '2026-04-20T12:04:00.000Z',
    });

    const res = recordPlanningAgentComment({
      owner: 'o',
      repo: 'r',
      issueNumber: 1,
      commentId: 10,
      createdAt: '2026-04-20T12:04:00.000Z',
      body: '<!-- along:plan {"planId":"plan_v2","version":2,"basedOnPlanId":"plan_v1","roundId":"round_1"} -->\n## Plan v2',
    });

    expect(res).toEqual({ success: true, data: 'plan' });
    expect(state.plans).toHaveLength(1);
    expect(state.threads[0].version).toBe(3);
    expect(state.rounds[0].produced_plan_id).toBe('plan_v2');
  });

  it('已产出正式计划的 round 会忽略后续冲突计划评论', () => {
    state.threads.push({
      owner: 'o',
      repo: 'r',
      issue_number: 1,
      version: 3,
      is_closed: 0,
      current_plan_id: 'plan_v2',
      open_round_id: null,
      approved_plan_id: null,
      last_processed_comment_id: 1,
      updated_at: '2026-04-20T12:05:00.000Z',
    });
    state.plans.push({
      owner: 'o',
      repo: 'r',
      issue_number: 1,
      plan_id: 'plan_v2',
      version: 2,
      based_on_plan_id: 'plan_v1',
      status: 'active',
      comment_id: 10,
      summary: 'Plan v2',
      scope: null,
      changes: null,
      risks: null,
      validation: null,
      decision_log: null,
      changes_since_last_version: null,
      body: 'body',
      created_at: '2026-04-20T12:04:00.000Z',
    });
    state.rounds.push({
      owner: 'o',
      repo: 'r',
      issue_number: 1,
      round_id: 'round_1',
      based_on_plan_id: 'plan_v1',
      snapshot_comment_ids: '[1]',
      snapshot_last_seen_comment_id: 1,
      status: 'resolved',
      resolution: 'revise_plan',
      produced_plan_id: 'plan_v2',
      created_at: '2026-04-20T12:03:00.000Z',
      resolved_at: '2026-04-20T12:04:00.000Z',
    });

    const res = recordPlanningAgentComment({
      owner: 'o',
      repo: 'r',
      issueNumber: 1,
      commentId: 11,
      createdAt: '2026-04-20T12:05:00.000Z',
      body: '<!-- along:plan {"planId":"plan_v2_dup","version":2,"basedOnPlanId":"plan_v1","roundId":"round_1"} -->\n## Plan v2',
    });

    expect(res).toEqual({ success: true, data: 'ignored' });
    expect(state.plans).toHaveLength(1);
    expect(state.plans[0].plan_id).toBe('plan_v2');
  });

  it('审批被 open round 阻塞时返回 round 与当前计划信息', () => {
    state.threads.push({
      owner: 'o',
      repo: 'r',
      issue_number: 1,
      version: 2,
      is_closed: 0,
      current_plan_id: 'plan_v1',
      open_round_id: 'round_1',
      approved_plan_id: null,
      last_processed_comment_id: null,
      updated_at: '2026-04-20T12:02:00.000Z',
    });
    state.plans.push({
      owner: 'o',
      repo: 'r',
      issue_number: 1,
      plan_id: 'plan_v1',
      version: 1,
      based_on_plan_id: null,
      status: 'active',
      comment_id: 1,
      summary: 'Plan v1',
      scope: null,
      changes: null,
      risks: null,
      validation: null,
      decision_log: null,
      changes_since_last_version: null,
      body: 'body',
      created_at: '2026-04-20T12:01:00.000Z',
    });

    const res = approvePlan('o', 'r', 1, { mode: 'version', version: 1 }, 99);

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toContain('round=round_1');
      expect(res.error).toContain('Plan v1 (plan_v1)');
    }
  });
});
