import { iso_timestamp } from "./common";

export type WorkflowPhase = "phase1" | "phase2";

export type SessionLifecycleStatus =
  | "phase1_running"
  | "awaiting_approval"
  | "phase2_running"
  | "awaiting_pr"
  | "pr_open"
  | "review_fixing"
  | "ci_fixing"
  | "merged"
  | "error"
  | "crashed";

export interface SessionStateSnapshot {
  status?: SessionLifecycleStatus;
  workflowPhase?: WorkflowPhase;
  currentStep?: string;
  lastMessage?: string;
  endTime?: string;
  errorMessage?: string;
  crashLog?: string;
  exitCode?: number;
  prUrl?: string;
  prNumber?: number;
  pid?: number;
}

export type SessionStateEvent =
  | { type: "START_PHASE"; phase: WorkflowPhase; message?: string }
  | { type: "AGENT_EXITED_SUCCESS"; phase: WorkflowPhase; message?: string }
  | { type: "AGENT_EXITED_FAILURE"; message: string; exitCode?: number; crashLog?: string }
  | { type: "RECOVERY_DETECTED_CRASH"; message: string }
  | { type: "BLOCKED"; message: string; exitCode?: number }
  | { type: "BRANCH_PREPARED"; branchName?: string }
  | { type: "COMMITS_PUSHED" }
  | { type: "PR_CREATED"; prUrl: string; prNumber?: number; message?: string }
  | { type: "REVIEW_FIX_STARTED"; commentCount: number }
  | { type: "REVIEW_FIX_COMPLETED" }
  | { type: "CI_FIX_STARTED"; failedCount: number }
  | { type: "CI_FIX_COMPLETED" }
  | { type: "PR_MERGED"; message?: string };

export interface SessionStateTransition {
  nextStatus: SessionLifecycleStatus;
  patch: Record<string, unknown>;
}

function assertReachable(_value: never): never {
  throw new Error("未处理的状态机分支");
}

export function isActiveSessionStatus(status?: SessionLifecycleStatus): boolean {
  return status === "phase1_running"
    || status === "phase2_running"
    || status === "review_fixing"
    || status === "ci_fixing";
}

export function getDisplayStep(status: SessionLifecycleStatus): string {
  switch (status) {
    case "phase1_running":
      return "Phase 1 执行中";
    case "awaiting_approval":
      return "等待审批";
    case "phase2_running":
      return "Phase 2 执行中";
    case "awaiting_pr":
      return "等待创建 PR";
    case "pr_open":
      return "等待 PR 合并";
    case "review_fixing":
      return "处理 PR 评论";
    case "ci_fixing":
      return "修复 CI";
    case "merged":
      return "已合并";
    case "error":
      return "执行受阻";
    case "crashed":
      return "进程崩溃";
    default:
      return assertReachable(status);
  }
}

function clearTerminalFields() {
  return {
    errorMessage: undefined,
    crashLog: undefined,
    exitCode: undefined,
    endTime: undefined,
  };
}

export function applySessionStateEvent(
  current: SessionStateSnapshot | null,
  event: SessionStateEvent,
): SessionStateTransition {
  const now = iso_timestamp();

  switch (event.type) {
    case "START_PHASE": {
      const nextStatus = event.phase === "phase1" ? "phase1_running" : "phase2_running";
      return {
        nextStatus,
        patch: {
          status: nextStatus,
          workflowPhase: event.phase,
          currentStep: getDisplayStep(nextStatus),
          lastMessage: event.message ?? `启动 ${event.phase}`,
          pid: undefined,
          ...clearTerminalFields(),
        },
      };
    }

    case "AGENT_EXITED_SUCCESS": {
      if (event.phase === "phase1") {
        return {
          nextStatus: "awaiting_approval",
          patch: {
            status: "awaiting_approval",
            workflowPhase: "phase1",
            currentStep: getDisplayStep("awaiting_approval"),
            lastMessage: event.message ?? "Phase 1 已完成，等待人工审批",
            pid: undefined,
            ...clearTerminalFields(),
            endTime: now,
          },
        };
      }

      const nextStatus = current?.prUrl || current?.prNumber ? "pr_open" : "awaiting_pr";
      return {
        nextStatus,
        patch: {
          status: nextStatus,
          workflowPhase: "phase2",
          currentStep: getDisplayStep(nextStatus),
          lastMessage: event.message ?? (nextStatus === "pr_open" ? "Phase 2 已完成，等待 PR 合并" : "Phase 2 已完成，等待创建 PR"),
          pid: undefined,
          ...clearTerminalFields(),
          endTime: nextStatus === "pr_open" ? undefined : now,
        },
      };
    }

    case "AGENT_EXITED_FAILURE":
      return {
        nextStatus: "crashed",
        patch: {
          status: "crashed",
          currentStep: getDisplayStep("crashed"),
          lastMessage: event.message,
          errorMessage: event.message,
          crashLog: event.crashLog,
          exitCode: event.exitCode,
          pid: undefined,
          endTime: now,
        },
      };

    case "RECOVERY_DETECTED_CRASH":
      return {
        nextStatus: "crashed",
        patch: {
          status: "crashed",
          currentStep: getDisplayStep("crashed"),
          lastMessage: event.message,
          errorMessage: event.message,
          pid: undefined,
          endTime: now,
        },
      };

    case "BLOCKED":
      return {
        nextStatus: "error",
        patch: {
          status: "error",
          currentStep: getDisplayStep("error"),
          lastMessage: event.message,
          errorMessage: event.message,
          exitCode: event.exitCode,
          pid: undefined,
          endTime: now,
          crashLog: undefined,
        },
      };

    case "BRANCH_PREPARED":
      return {
        nextStatus: current?.status || "phase1_running",
        patch: {
          currentStep: "分析代码库并制定实施计划",
          lastMessage: event.branchName ? `已创建语义化分支 ${event.branchName}` : "已创建语义化分支",
        },
      };

    case "COMMITS_PUSHED":
      return {
        nextStatus: "phase2_running",
        patch: {
          status: "phase2_running",
          workflowPhase: "phase2",
          currentStep: "创建 PR",
          lastMessage: "代码已提交推送",
          endTime: undefined,
          ...clearTerminalFields(),
        },
      };

    case "PR_CREATED":
      return {
        nextStatus: "pr_open",
        patch: {
          status: "pr_open",
          workflowPhase: "phase2",
          prUrl: event.prUrl,
          prNumber: event.prNumber,
          currentStep: getDisplayStep("pr_open"),
          lastMessage: event.message ?? "PR 已创建，等待审核与合并",
          endTime: undefined,
          ...clearTerminalFields(),
        },
      };

    case "REVIEW_FIX_STARTED":
      return {
        nextStatus: "review_fixing",
        patch: {
          status: "review_fixing",
          workflowPhase: "phase2",
          currentStep: getDisplayStep("review_fixing"),
          lastMessage: `发现 ${event.commentCount} 条未解决的评论`,
          endTime: undefined,
          ...clearTerminalFields(),
        },
      };

    case "REVIEW_FIX_COMPLETED":
      return {
        nextStatus: "pr_open",
        patch: {
          status: "pr_open",
          workflowPhase: "phase2",
          currentStep: getDisplayStep("pr_open"),
          lastMessage: "PR 评论已处理，等待再次审核",
          endTime: undefined,
          ...clearTerminalFields(),
        },
      };

    case "CI_FIX_STARTED":
      return {
        nextStatus: "ci_fixing",
        patch: {
          status: "ci_fixing",
          workflowPhase: "phase2",
          currentStep: getDisplayStep("ci_fixing"),
          lastMessage: `发现 ${event.failedCount} 个失败的 CI 检查`,
          endTime: undefined,
          ...clearTerminalFields(),
        },
      };

    case "CI_FIX_COMPLETED":
      return {
        nextStatus: "pr_open",
        patch: {
          status: "pr_open",
          workflowPhase: "phase2",
          currentStep: getDisplayStep("pr_open"),
          lastMessage: "CI 修复完成，等待重新检查",
          endTime: undefined,
          ...clearTerminalFields(),
        },
      };

    case "PR_MERGED":
      return {
        nextStatus: "merged",
        patch: {
          status: "merged",
          workflowPhase: "phase2",
          currentStep: getDisplayStep("merged"),
          lastMessage: event.message ?? "PR 已合并，Issue 已解决",
          pid: undefined,
          endTime: now,
          ...clearTerminalFields(),
        },
      };

    default:
      return assertReachable(event);
  }
}
