import { describe, expect, it, vi, beforeEach } from "vitest";

const fileMap = new Map<string, string>();

vi.mock("../config", () => ({
  config: {
    USER_ALONG_DIR: "/mock/.along",
    getIssueDir: (owner: string, repo: string, issueNumber: number) =>
      `/mock/.along/${owner}/${repo}/${issueNumber}`,
  },
}));

vi.mock("../result", () => ({
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
}));

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn((filePath: string) => fileMap.has(filePath)),
    readFileSync: vi.fn((filePath: string) => fileMap.get(filePath) || ""),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

import { SessionPathManager } from "../session-paths";
import { generateSessionDiagnostic } from "../session-diagnostics";

describe("session-diagnostics.ts", () => {
  const paths = new SessionPathManager("ranwawa", "along", 41);

  beforeEach(() => {
    fileMap.clear();
  });

  it("能将 403 insufficient balance 归类为 auth/billing", () => {
    const sessionJsonl = [
      JSON.stringify({ timestamp: "2026-04-20T12:00:00.000Z", category: "lifecycle", source: "session-manager", level: "error", message: "Agent 退出" }),
      JSON.stringify({ timestamp: "2026-04-20T12:00:01.000Z", category: "conversation", source: "agent-stderr", level: "info", message: "Starting at Mon Apr 20 20:30:30 CST 2026" }),
      JSON.stringify({ timestamp: "2026-04-20T12:00:02.000Z", category: "conversation", source: "agent-stderr", level: "info", message: "Failed to authenticate. API Error: 403 insufficient balance" }),
    ].join("\n") + "\n";

    fileMap.set(paths.getSessionLogFile(), sessionJsonl);

    const diagnostic = generateSessionDiagnostic(
      {
        issueNumber: 41,
        lifecycle: "interrupted",
        phase: "planning",
        step: "draft_plan",
        startTime: "2026-04-20T12:00:00.000Z",
        endTime: "2026-04-20T12:01:00.000Z",
        worktreePath: "",
        title: "Issue #41",
        repo: { owner: "ranwawa", name: "along" },
        context: { issueNumber: 41 },
        error: {
          code: "EXIT_1",
          message: "Agent 退出码: 1",
        },
      },
      paths,
    );

    expect(diagnostic.category).toBe("auth/billing");
    expect(diagnostic.summary).toContain("账户余额不足");
    expect(diagnostic.lastAgentLines.at(-1)).toContain("403 insufficient balance");
  });
});
