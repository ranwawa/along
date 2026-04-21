import { iso_timestamp } from "./common";

export type SessionLifecycle =
  | "running"
  | "waiting_human"
  | "waiting_external"
  | "completed"
  | "failed"
  | "interrupted";

export type SessionPhase =
  | "planning"
  | "implementation"
  | "delivery"
  | "stabilization"
  | "done";

export type SessionStep =
  | "read_issue"
  | "understand_scope"
  | "prepare_workspace"
  | "prepare_branch"
  | "analyze_codebase"
  | "identify_change_set"
  | "draft_plan"
  | "publish_plan"
  | "await_approval"
  | "sync_approved_plan"
  | "edit_code"
  | "update_tests"
  | "run_targeted_validation"
  | "record_progress"
  | "prepare_commit"
  | "push_commits"
  | "draft_pr"
  | "open_pr"
  | "triage_review_feedback"
  | "address_review_feedback"
  | "triage_ci_failures"
  | "fix_ci"
  | "await_merge"
  | "archive_result";

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
  | { type: "START_PHASE"; phase: SessionPhase; step: SessionStep; message?: string }
  | { type: "AGENT_EXITED_SUCCESS"; message?: string }
  | { type: "AGENT_EXITED_FAILURE"; message: string; exitCode?: number; crashLog?: string }
  | { type: "RECOVERY_DETECTED_CRASH"; message: string }
  | { type: "BLOCKED"; message: string; exitCode?: number }
  | {
    type: "STEP_CHANGED";
    phase: SessionPhase;
    step: SessionStep;
    message?: string;
    progress?: SessionProgress;
    context?: Partial<SessionContext>;
  }
  | { type: "BRANCH_PREPARED"; branchName?: string }
  | { type: "COMMITS_PUSHED" }
  | { type: "PR_CREATED"; prUrl: string; prNumber?: number; message?: string }
  | { type: "REVIEW_FIX_STARTED"; commentCount: number }
  | { type: "REVIEW_FIX_COMPLETED" }
  | { type: "CI_FIX_STARTED"; failedCount: number }
  | { type: "CI_FIX_COMPLETED" }
  | { type: "PR_MERGED"; message?: string };

export interface SessionStateTransition {
  nextLifecycle: SessionLifecycle;
  patch: Record<string, unknown>;
}

export function isActiveSessionLifecycle(lifecycle?: SessionLifecycle): boolean {
  return lifecycle === "running";
}

export function isActiveSessionStatus(lifecycle?: SessionLifecycle): boolean {
  return isActiveSessionLifecycle(lifecycle);
}

export function getLifecycleLabel(lifecycle: SessionLifecycle): string {
  switch (lifecycle) {
    case "running":
      return "Running";
    case "waiting_human":
      return "Waiting Human";
    case "waiting_external":
      return "Waiting External";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "interrupted":
      return "Interrupted";
  }
}

export function getPhaseLabel(phase: SessionPhase): string {
  switch (phase) {
    case "planning":
      return "Planning";
    case "implementation":
      return "Implementation";
    case "delivery":
      return "Delivery";
    case "stabilization":
      return "Stabilization";
    case "done":
      return "Done";
  }
}

export function getStepLabel(step: SessionStep): string {
  switch (step) {
    case "read_issue":
      return "Read Issue";
    case "understand_scope":
      return "Understand Scope";
    case "prepare_workspace":
      return "Prepare Workspace";
    case "prepare_branch":
      return "Prepare Branch";
    case "analyze_codebase":
      return "Analyze Codebase";
    case "identify_change_set":
      return "Identify Change Set";
    case "draft_plan":
      return "Draft Plan";
    case "publish_plan":
      return "Publish Plan";
    case "await_approval":
      return "Await Approval";
    case "sync_approved_plan":
      return "Sync Approved Plan";
    case "edit_code":
      return "Edit Code";
    case "update_tests":
      return "Update Tests";
    case "run_targeted_validation":
      return "Run Targeted Validation";
    case "record_progress":
      return "Record Progress";
    case "prepare_commit":
      return "Prepare Commit";
    case "push_commits":
      return "Push Commits";
    case "draft_pr":
      return "Draft PR";
    case "open_pr":
      return "Open PR";
    case "triage_review_feedback":
      return "Triage Review Feedback";
    case "address_review_feedback":
      return "Address Review Feedback";
    case "triage_ci_failures":
      return "Triage CI Failures";
    case "fix_ci":
      return "Fix CI";
    case "await_merge":
      return "Await Merge";
    case "archive_result":
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
  const nextLifecycle = updates.lifecycle ?? current?.lifecycle ?? "running";
  const nextPhase = updates.phase ?? current?.phase ?? "planning";
  const nextStep = updates.step ?? current?.step ?? "read_issue";
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
    case "START_PHASE": {
      return nextStatePatch(current, {
        lifecycle: "running",
        phase: event.phase,
        step: event.step,
        message: event.message ?? `启动 ${getPhaseLabel(event.phase)}`,
        progress: undefined,
        error: null,
        pid: undefined,
      });
    }

    case "AGENT_EXITED_SUCCESS":
      if (!current?.phase || current.phase === "planning") {
        return nextStatePatch(current, {
          lifecycle: "waiting_human",
          phase: "planning",
          step: "await_approval",
          message: event.message ?? "规划阶段已完成，等待人工审批",
          pid: undefined,
          endTime: now,
        });
      }

      if (current?.context?.prUrl || current?.context?.prNumber) {
        return nextStatePatch(current, {
          lifecycle: "waiting_external",
          phase: "stabilization",
          step: "await_merge",
          message: event.message ?? "交付已完成，等待 PR 审核与合并",
          pid: undefined,
          endTime: undefined,
          error: null,
        });
      }

      return nextStatePatch(current, {
        lifecycle: "waiting_human",
        phase: "delivery",
        step: "draft_pr",
        message: event.message ?? "交付阶段已完成，等待补充 PR",
        pid: undefined,
        endTime: now,
      });

    case "AGENT_EXITED_FAILURE":
      return nextStatePatch(current, {
        lifecycle: "interrupted",
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

    case "RECOVERY_DETECTED_CRASH":
      return nextStatePatch(current, {
        lifecycle: "interrupted",
        message: event.message,
        error: {
          message: event.message,
          retryable: true,
        },
        pid: undefined,
        endTime: now,
      });

    case "BLOCKED":
      return nextStatePatch(current, {
        lifecycle: "failed",
        message: event.message,
        error: {
          message: event.message,
          code: event.exitCode ? `EXIT_${event.exitCode}` : undefined,
          retryable: true,
        },
        pid: undefined,
        endTime: now,
      });

    case "STEP_CHANGED":
      return nextStatePatch(current, {
        lifecycle: "running",
        phase: event.phase,
        step: event.step,
        message: event.message ?? current?.message,
        progress: event.progress,
        context: event.context,
        endTime: undefined,
      });

    case "BRANCH_PREPARED":
      return nextStatePatch(current, {
        lifecycle: "running",
        phase: "planning",
        step: "analyze_codebase",
        message: event.branchName ? `已创建语义化分支 ${event.branchName}` : "已创建语义化分支",
        context: { branchName: event.branchName },
        error: null,
        endTime: undefined,
      });

    case "COMMITS_PUSHED":
      return nextStatePatch(current, {
        lifecycle: "running",
        phase: "delivery",
        step: "draft_pr",
        message: "代码已提交推送，准备创建 PR",
        endTime: undefined,
        error: null,
      });

    case "PR_CREATED":
      return nextStatePatch(current, {
        lifecycle: "waiting_external",
        phase: "stabilization",
        step: "await_merge",
        message: event.message ?? "PR 已创建，等待审核与合并",
        context: {
          prUrl: event.prUrl,
          prNumber: event.prNumber,
        },
        endTime: undefined,
        error: null,
      });

    case "REVIEW_FIX_STARTED":
      return nextStatePatch(current, {
        lifecycle: "running",
        phase: "stabilization",
        step: "address_review_feedback",
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

    case "REVIEW_FIX_COMPLETED":
      return nextStatePatch(current, {
        lifecycle: "waiting_external",
        phase: "stabilization",
        step: "await_merge",
        message: "PR 评论已处理，等待再次审核",
        progress: undefined,
        endTime: undefined,
        error: null,
      });

    case "CI_FIX_STARTED":
      return nextStatePatch(current, {
        lifecycle: "running",
        phase: "stabilization",
        step: "fix_ci",
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

    case "CI_FIX_COMPLETED":
      return nextStatePatch(current, {
        lifecycle: "waiting_external",
        phase: "stabilization",
        step: "await_merge",
        message: "CI 修复完成，等待重新检查",
        progress: undefined,
        endTime: undefined,
        error: null,
      });

    case "PR_MERGED":
      return nextStatePatch(current, {
        lifecycle: "completed",
        phase: "done",
        step: "archive_result",
        message: event.message ?? "PR 已合并，Issue 已解决",
        pid: undefined,
        endTime: now,
        error: null,
      });
  }
}
