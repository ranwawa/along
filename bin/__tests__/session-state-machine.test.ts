import { describe, expect, it, vi } from "vitest";

vi.mock("../common", () => ({
  iso_timestamp: () => "2026-04-20T12:00:00.000Z",
}));

import { applySessionStateEvent, isActiveSessionStatus } from "../session-state-machine";

describe("session-state-machine.ts", () => {
  it("phase1 成功后进入 waiting_human/planning/await_approval", () => {
    const result = applySessionStateEvent(
      { lifecycle: "running", phase: "planning", step: "draft_plan", context: { issueNumber: 1 } },
      { type: "AGENT_EXITED_SUCCESS", workflow: "phase1" },
    );

    expect(result.nextLifecycle).toBe("waiting_human");
    expect(result.patch.lifecycle).toBe("waiting_human");
    expect(result.patch.phase).toBe("planning");
    expect(result.patch.step).toBe("await_approval");
    expect(result.patch.endTime).toBe("2026-04-20T12:00:00.000Z");
  });

  it("phase2 成功且已有 PR 时进入 waiting_external/stabilization/await_merge", () => {
    const result = applySessionStateEvent(
      {
        lifecycle: "running",
        phase: "delivery",
        step: "open_pr",
        context: { issueNumber: 1, prUrl: "https://example.com/pull/1" },
      },
      { type: "AGENT_EXITED_SUCCESS", workflow: "phase2" },
    );

    expect(result.nextLifecycle).toBe("waiting_external");
    expect(result.patch.phase).toBe("stabilization");
    expect(result.patch.step).toBe("await_merge");
    expect(result.patch.endTime).toBeUndefined();
  });

  it("PR 合并后进入 completed/done/archive_result", () => {
    const result = applySessionStateEvent(
      { lifecycle: "waiting_external", phase: "stabilization", step: "await_merge", context: { issueNumber: 1 } },
      { type: "PR_MERGED" },
    );

    expect(result.nextLifecycle).toBe("completed");
    expect(result.patch.phase).toBe("done");
    expect(result.patch.step).toBe("archive_result");
  });

  it("只将执行中状态视为活跃状态", () => {
    expect(isActiveSessionStatus("running")).toBe(true);
    expect(isActiveSessionStatus("waiting_external")).toBe(false);
    expect(isActiveSessionStatus("waiting_human")).toBe(false);
    expect(isActiveSessionStatus("completed")).toBe(false);
  });
});
