import { describe, expect, it, vi } from "vitest";

vi.mock("../common", () => ({
  iso_timestamp: () => "2026-04-20T12:00:00.000Z",
}));

import { applySessionStateEvent, isActiveSessionStatus } from "../session-state-machine";

describe("session-state-machine.ts", () => {
  it("phase1 成功后进入 awaiting_approval", () => {
    const result = applySessionStateEvent(
      { status: "phase1_running", workflowPhase: "phase1" },
      { type: "AGENT_EXITED_SUCCESS", phase: "phase1" },
    );

    expect(result.nextStatus).toBe("awaiting_approval");
    expect(result.patch.status).toBe("awaiting_approval");
    expect(result.patch.endTime).toBe("2026-04-20T12:00:00.000Z");
  });

  it("phase2 成功且已有 PR 时保持 pr_open", () => {
    const result = applySessionStateEvent(
      { status: "phase2_running", workflowPhase: "phase2", prUrl: "https://example.com/pull/1" },
      { type: "AGENT_EXITED_SUCCESS", phase: "phase2" },
    );

    expect(result.nextStatus).toBe("pr_open");
    expect(result.patch.status).toBe("pr_open");
    expect(result.patch.endTime).toBeUndefined();
  });

  it("PR 合并后进入 merged", () => {
    const result = applySessionStateEvent(
      { status: "pr_open", workflowPhase: "phase2" },
      { type: "PR_MERGED" },
    );

    expect(result.nextStatus).toBe("merged");
    expect(result.patch.status).toBe("merged");
  });

  it("只将执行中状态视为活跃状态", () => {
    expect(isActiveSessionStatus("phase1_running")).toBe(true);
    expect(isActiveSessionStatus("ci_fixing")).toBe(true);
    expect(isActiveSessionStatus("awaiting_approval")).toBe(false);
    expect(isActiveSessionStatus("merged")).toBe(false);
  });
});
