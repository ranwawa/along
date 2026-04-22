import { iso_timestamp } from "./common";

// === 统一常量 ===
export const LIFECYCLE = {
  RUNNING: "running",
  WAITING_HUMAN: "waiting_human",
  WAITING_EXTERNAL: "waiting_external",
  COMPLETED: "completed",
  FAILED: "failed",
  INTERRUPTED: "interrupted",
} as const;

export type SessionLifecycle = typeof LIFECYCLE[keyof typeof LIFECYCLE];

export const LIFECYCLE_LABELS = Object.values(LIFECYCLE);

export const COMMAND = {
  APPROVE: "/approve",
  REJECT: "/reject",
} as const;

export type CommandType = typeof COMMAND[keyof typeof COMMAND];

export const PHASE = {
  PLANNING: "planning",
  IMPLEMENTATION: "implementation",
  DELIVERY: "delivery",
  STABILIZATION: "stabilization",
  DONE: "done",
} as const;

export type SessionPhase = typeof PHASE[keyof typeof PHASE];

export const STEP = {
  READ_ISSUE: "read_issue",
  UNDERSTAND_SCOPE: "understand_scope",
  PREPARE_WORKSPACE: "prepare_workspace",
  PREPARE_BRANCH: "prepare_branch",
  ANALYZE_CODEBASE: "analyze_codebase",
  IDENTIFY_CHANGE_SET: "identify_change_set",
  DRAFT_PLAN: "draft_plan",
  PUBLISH_PLAN: "publish_plan",
  AWAIT_INPUT: "await_input",
  PROCESS_ROUND: "process_round",
  AWAIT_APPROVAL: "await_approval",
  SYNC_APPROVED_PLAN: "sync_approved_plan",
  EDIT_CODE: "edit_code",
  UPDATE_TESTS: "update_tests",
  RUN_TARGETED_VALIDATION: "run_targeted_validation",
  RECORD_PROGRESS: "record_progress",
  PREPARE_COMMIT: "prepare_commit",
  PUSH_COMMITS: "push_commits",
  DRAFT_PR: "draft_pr",
  OPEN_PR: "open_pr",
  TRIAGE_REVIEW_FEEDBACK: "triage_review_feedback",
  ADDRESS_REVIEW_FEEDBACK: "address_review_feedback",
  TRIAGE_CI_FAILURES: "triage_ci_failures",
  FIX_CI: "fix_ci",
  AWAIT_MERGE: "await_merge",
  ARCHIVE_RESULT: "archive_result",
} as const;

export type SessionStep = typeof STEP[keyof typeof STEP];

export const EVENT = {
  START_PHASE: "START_PHASE",
  AGENT_EXITED_SUCCESS: "AGENT_EXITED_SUCCESS",
  AGENT_EXITED_FAILURE: "AGENT_EXITED_FAILURE",
  RECOVERY_DETECTED_CRASH: "RECOVERY_DETECTED_CRASH",
  BLOCKED: "BLOCKED",
  STEP_CHANGED: "STEP_CHANGED",
  BRANCH_PREPARED: "BRANCH_PREPARED",
  COMMITS_PUSHED: "COMMITS_PUSHED",
  PR_CREATED: "PR_CREATED",
  REVIEW_FIX_STARTED: "REVIEW_FIX_STARTED",
  REVIEW_FIX_COMPLETED: "REVIEW_FIX_COMPLETED",
  CI_FIX_STARTED: "CI_FIX_STARTED",
  CI_FIX_COMPLETED: "CI_FIX_COMPLETED",
  PR_MERGED: "PR_MERGED",
  APPROVED: "APPROVED",
  MANUAL_STATUS_UPDATE: "MANUAL_STATUS_UPDATE",
} as const;

export type EventType = typeof EVENT[keyof typeof EVENT];

export interface SessionProgress {
  current?: number;
  total?: number;
  unit?: string;
  label?: string;
}

export interface SessionContext {
  issueNumber: number;
  title?: string;
  repo?: string;
  branchName?: string;
  commitShas?: string[];
  prNumber?: number;
  prUrl?: string;
  reviewCommentCount?: number;
  failedCiCount?: number;
  changedFiles?: string[];
  worktreePath?: string;
  environment?: Record<string, string>;
  agentType?: string;
  agentCommand?: string;
  ciResults?: string;
}

export interface SessionError {
  code?: string;
  message: string;
  retryable?: boolean;
  details?: string;
}

export interface SessionStateSnapshot {
  lifecycle?: SessionLifecycle;
  phase?: SessionPhase;
  step?: SessionStep;
  message?: string;
  progress?: SessionProgress;
  context?: SessionContext;
  error?: SessionError;
  endTime?: string;
  phaseStartedAt?: string;
  stepStartedAt?: string;
  pid?: number;
}

export type SessionStateEvent =
  | { type: typeof EVENT["START_PHASE"]; phase: SessionPhase; step: SessionStep; message?: string }
  | { type: typeof EVENT["AGENT_EXITED_SUCCESS"]; message?: string }
  | { type: typeof EVENT["AGENT_EXITED_FAILURE"]; message: string; exitCode?: number; crashLog?: string }
  | { type: typeof EVENT["RECOVERY_DETECTED_CRASH"]; message: string }
  | { type: typeof EVENT["BLOCKED"]; message: string; exitCode?: number }
  | {
    type: typeof EVENT["STEP_CHANGED"];
    phase: SessionPhase;
    step: SessionStep;
    message?: string;
    progress?: SessionProgress;
    context?: Partial<SessionContext>;
    pid?: number;
  }
  | { type: typeof EVENT["BRANCH_PREPARED"]; branchName?: string }
  | { type: typeof EVENT["COMMITS_PUSHED"] }
  | { type: typeof EVENT["PR_CREATED"]; prUrl: string; prNumber?: number; message?: string }
  | { type: typeof EVENT["REVIEW_FIX_STARTED"]; commentCount: number }
  | { type: typeof EVENT["REVIEW_FIX_COMPLETED"] }
  | { type: typeof EVENT["CI_FIX_STARTED"]; failedCount: number }
  | { type: typeof EVENT["CI_FIX_COMPLETED"] }
  | { type: typeof EVENT["PR_MERGED"]; message?: string }
  | { type: typeof EVENT["APPROVED"] }
  | { type: typeof EVENT["MANUAL_STATUS_UPDATE"]; lifecycle: SessionLifecycle; message?: string; step?: SessionStep };

export interface SessionStateTransition {
  nextLifecycle: SessionLifecycle;
  patch: Record<string, unknown>;
}

export function isActiveSessionLifecycle(lifecycle?: SessionLifecycle): boolean {
  return lifecycle === LIFECYCLE.RUNNING;
}

export function isActiveSessionStatus(lifecycle?: SessionLifecycle): boolean {
  return isActiveSessionLifecycle(lifecycle);
}

export function getLifecycleLabel(lifecycle: SessionLifecycle): string {
  switch (lifecycle) {
    case LIFECYCLE.RUNNING:
      return "Running";
    case LIFECYCLE.WAITING_HUMAN:
      return "Waiting Human";
    case LIFECYCLE.WAITING_EXTERNAL:
      return "Waiting External";
    case LIFECYCLE.COMPLETED:
      return "Completed";
    case LIFECYCLE.FAILED:
      return "Failed";
    case LIFECYCLE.INTERRUPTED:
      return "Interrupted";
  }
}

export function getPhaseLabel(phase: SessionPhase): string {
  switch (phase) {
    case PHASE.PLANNING:
      return "Planning";
    case PHASE.IMPLEMENTATION:
      return "Implementation";
    case PHASE.DELIVERY:
      return "Delivery";
    case PHASE.STABILIZATION:
      return "Stabilization";
    case PHASE.DONE:
      return "Done";
  }
}

export function getStepLabel(step: SessionStep): string {
  switch (step) {
    case STEP.READ_ISSUE:
      return "Read Issue";
    case STEP.UNDERSTAND_SCOPE:
      return "Understand Scope";
    case STEP.PREPARE_WORKSPACE:
      return "Prepare Workspace";
    case STEP.PREPARE_BRANCH:
      return "Prepare Branch";
    case STEP.ANALYZE_CODEBASE:
      return "Analyze Codebase";
    case STEP.IDENTIFY_CHANGE_SET:
      return "Identify Change Set";
    case STEP.DRAFT_PLAN:
      return "Draft Plan";
    case STEP.PUBLISH_PLAN:
      return "Publish Plan";
    case STEP.AWAIT_INPUT:
      return "Await Input";
    case STEP.PROCESS_ROUND:
      return "Process Round";
    case STEP.AWAIT_APPROVAL:
      return "Await Approval";
    case STEP.SYNC_APPROVED_PLAN:
      return "Sync Approved Plan";
    case STEP.EDIT_CODE:
      return "Edit Code";
    case STEP.UPDATE_TESTS:
      return "Update Tests";
    case STEP.RUN_TARGETED_VALIDATION:
      return "Run Targeted Validation";
    case STEP.RECORD_PROGRESS:
      return "Record Progress";
    case STEP.PREPARE_COMMIT:
      return "Prepare Commit";
    case STEP.PUSH_COMMITS:
      return "Push Commits";
    case STEP.DRAFT_PR:
      return "Draft PR";
    case STEP.OPEN_PR:
      return "Open PR";
    case STEP.TRIAGE_REVIEW_FEEDBACK:
      return "Triage Review Feedback";
    case STEP.ADDRESS_REVIEW_FEEDBACK:
      return "Address Review Feedback";
    case STEP.TRIAGE_CI_FAILURES:
      return "Triage CI Failures";
    case STEP.FIX_CI:
      return "Fix CI";
    case STEP.AWAIT_MERGE:
      return "Await Merge";
    case STEP.ARCHIVE_RESULT:
      return "Archive Result";
  }
}

function mergeContext(
  current: SessionContext | undefined,
  updates: Partial<SessionContext> | undefined,
): SessionContext | undefined {
  if (!current && !updates) return undefined;
  return { ...(current || {}), ...(updates || {}) } as SessionContext;
}

function nextStatePatch(
  current: SessionStateSnapshot | null,
  updates: {
    lifecycle?: SessionLifecycle;
    phase?: SessionPhase;
    step?: SessionStep;
    message?: string;
    progress?: SessionProgress;
    context?: Partial<SessionContext>;
    error?: SessionError | null;
    pid?: number;
    endTime?: string;
  },
): SessionStateTransition {
  const now = iso_timestamp();
  const nextLifecycle = updates.lifecycle ?? current?.lifecycle ?? LIFECYCLE.RUNNING;
  const nextPhase = updates.phase ?? current?.phase ?? PHASE.PLANNING;
  const nextStep = updates.step ?? current?.step ?? STEP.READ_ISSUE;
  const phaseChanged = nextPhase !== (current?.phase ?? nextPhase);
  const stepChanged = phaseChanged || nextStep !== (current?.step ?? nextStep);

  return {
    nextLifecycle,
    patch: {
      lifecycle: nextLifecycle,
      phase: nextPhase,
      step: nextStep,
      message: updates.message ?? current?.message,
      progress: updates.progress ?? current?.progress,
      context: mergeContext(current?.context, updates.context),
      error: updates.error === null ? undefined : (updates.error ?? current?.error),
      pid: updates.pid ?? current?.pid,
      phaseStartedAt: phaseChanged ? now : (current?.phaseStartedAt ?? now),
      stepStartedAt: stepChanged ? now : (current?.stepStartedAt ?? now),
      endTime: updates.endTime,
    },
  };
}

export function applySessionStateEvent(
  current: SessionStateSnapshot | null,
  event: SessionStateEvent,
): SessionStateTransition {
  const now = iso_timestamp();

  switch (event.type) {
    case EVENT.START_PHASE: {
      return nextStatePatch(current, {
        lifecycle: LIFECYCLE.RUNNING,
        phase: event.phase,
        step: event.step,
        message: event.message ?? `启动 ${getPhaseLabel(event.phase)}`,
        progress: undefined,
        error: null,
        pid: undefined,
      });
    }

    case EVENT.AGENT_EXITED_SUCCESS:
      if (!current?.phase || current.phase === PHASE.PLANNING) {
        return nextStatePatch(current, {
          lifecycle: LIFECYCLE.WAITING_HUMAN,
          phase: PHASE.PLANNING,
          step: STEP.AWAIT_APPROVAL,
          message: event.message ?? "规划阶段已完成，等待人工审批",
          pid: undefined,
          endTime: now,
        });
      }

      if (current?.context?.prUrl || current?.context?.prNumber) {
        return nextStatePatch(current, {
          lifecycle: LIFECYCLE.WAITING_EXTERNAL,
          phase: PHASE.STABILIZATION,
          step: STEP.AWAIT_MERGE,
          message: event.message ?? "交付已完成，等待 PR 审核与合并",
          pid: undefined,
          endTime: undefined,
          error: null,
        });
      }

      return nextStatePatch(current, {
        lifecycle: LIFECYCLE.WAITING_HUMAN,
        phase: PHASE.DELIVERY,
        step: STEP.DRAFT_PR,
        message: event.message ?? "交付阶段已完成，等待补充 PR",
        pid: undefined,
        endTime: now,
      });

    case EVENT.AGENT_EXITED_FAILURE:
      return nextStatePatch(current, {
        lifecycle: LIFECYCLE.INTERRUPTED,
        message: event.message,
        error: {
          message: event.message,
          details: event.crashLog,
          code: event.exitCode ? `EXIT_${event.exitCode}` : undefined,
          retryable: true,
        },
        pid: undefined,
        endTime: now,
      });

    case EVENT.RECOVERY_DETECTED_CRASH:
      return nextStatePatch(current, {
        lifecycle: LIFECYCLE.INTERRUPTED,
        message: event.message,
        error: {
          message: event.message,
          retryable: true,
        },
        pid: undefined,
        endTime: now,
      });

    case EVENT.BLOCKED:
      return nextStatePatch(current, {
        lifecycle: LIFECYCLE.FAILED,
        message: event.message,
        error: {
          message: event.message,
          code: event.exitCode ? `EXIT_${event.exitCode}` : undefined,
          retryable: true,
        },
        pid: undefined,
        endTime: now,
      });

    case EVENT.STEP_CHANGED:
      return nextStatePatch(current, {
        lifecycle: LIFECYCLE.RUNNING,
        phase: event.phase,
        step: event.step,
        message: event.message ?? current?.message,
        progress: event.progress,
        context: event.context,
        pid: event.pid,
        endTime: undefined,
      });

    case EVENT.BRANCH_PREPARED:
      return nextStatePatch(current, {
        lifecycle: LIFECYCLE.RUNNING,
        phase: PHASE.PLANNING,
        step: STEP.ANALYZE_CODEBASE,
        message: event.branchName ? `已创建语义化分支 ${event.branchName}` : "已创建语义化分支",
        context: { branchName: event.branchName },
        error: null,
        endTime: undefined,
      });

    case EVENT.COMMITS_PUSHED:
      return nextStatePatch(current, {
        lifecycle: LIFECYCLE.RUNNING,
        phase: PHASE.DELIVERY,
        step: STEP.DRAFT_PR,
        message: "代码已提交推送，准备创建 PR",
        endTime: undefined,
        error: null,
      });

    case EVENT.PR_CREATED:
      return nextStatePatch(current, {
        lifecycle: LIFECYCLE.WAITING_EXTERNAL,
        phase: PHASE.STABILIZATION,
        step: STEP.AWAIT_MERGE,
        message: event.message ?? "PR 已创建，等待审核与合并",
        context: {
          prUrl: event.prUrl,
          prNumber: event.prNumber,
        },
        endTime: undefined,
        error: null,
      });

    case EVENT.REVIEW_FIX_STARTED:
      return nextStatePatch(current, {
        lifecycle: LIFECYCLE.RUNNING,
        phase: PHASE.STABILIZATION,
        step: STEP.ADDRESS_REVIEW_FEEDBACK,
        message: `发现 ${event.commentCount} 条未解决的评论`,
        context: { reviewCommentCount: event.commentCount },
        progress: {
          current: 0,
          total: event.commentCount,
          unit: "comments",
          label: "resolved",
        },
        endTime: undefined,
        error: null,
      });

    case EVENT.REVIEW_FIX_COMPLETED:
      return nextStatePatch(current, {
        lifecycle: LIFECYCLE.WAITING_EXTERNAL,
        phase: PHASE.STABILIZATION,
        step: STEP.AWAIT_MERGE,
        message: "PR 评论已处理，等待再次审核",
        progress: undefined,
        endTime: undefined,
        error: null,
      });

    case EVENT.CI_FIX_STARTED:
      return nextStatePatch(current, {
        lifecycle: LIFECYCLE.RUNNING,
        phase: PHASE.STABILIZATION,
        step: STEP.FIX_CI,
        message: `发现 ${event.failedCount} 个失败的 CI 检查`,
        context: { failedCiCount: event.failedCount },
        progress: {
          current: 0,
          total: event.failedCount,
          unit: "checks",
          label: "fixed",
        },
        endTime: undefined,
        error: null,
      });

    case EVENT.CI_FIX_COMPLETED:
      return nextStatePatch(current, {
        lifecycle: LIFECYCLE.WAITING_EXTERNAL,
        phase: PHASE.STABILIZATION,
        step: STEP.AWAIT_MERGE,
        message: "CI 修复完成，等待重新检查",
        progress: undefined,
        endTime: undefined,
        error: null,
      });

    case EVENT.PR_MERGED:
      return nextStatePatch(current, {
        lifecycle: LIFECYCLE.COMPLETED,
        phase: PHASE.DONE,
        step: STEP.ARCHIVE_RESULT,
        message: event.message ?? "PR 已合并，Issue 已解决",
        pid: undefined,
        endTime: now,
        error: null,
      });

    case EVENT.APPROVED:
      if (current?.phase === PHASE.PLANNING && current?.lifecycle === LIFECYCLE.WAITING_HUMAN) {
        return nextStatePatch(current, {
          lifecycle: LIFECYCLE.RUNNING,
          phase: PHASE.IMPLEMENTATION,
          step: STEP.EDIT_CODE,
          message: "已通过审批，启动实现阶段",
          error: null,
        });
      }
      return nextStatePatch(current, {});

    case EVENT.MANUAL_STATUS_UPDATE:
      return nextStatePatch(current, {
        lifecycle: event.lifecycle,
        message: event.message,
        step: event.step,
      });
  }
}
