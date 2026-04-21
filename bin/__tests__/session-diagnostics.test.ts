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
import { generateSessionDiagnostic, mergeSessionLogs, parseAgentLogLines, parseSystemLogLines, readSessionLog } from "../session-diagnostics";

describe("session-diagnostics.ts", () => {
  const paths = new SessionPathManager("ranwawa", "along", 41);

  beforeEach(() => {
    fileMap.clear();
  });

  it("能够解析 system.log 基本格式", () => {
    const result = parseSystemLogLines([
      "[2026-04-20T12:00:00.000Z] [INFO] Step: 启动 Agent",
    ]);

    expect(result[0].timestamp).toBe("2026-04-20T12:00:00.000Z");
    expect(result[0].level).toBe("info");
    expect(result[0].message).toBe("Step: 启动 Agent");
  });

  it("读取 agent 日志时返回原始行", () => {
    fileMap.set(paths.getAgentLogFile(), "line1\nline2\n");

    const result = readSessionLog(paths, "agent", 10);

    expect(result).toHaveLength(2);
    expect(result[1].message).toBe("line2");
  });

  it("能够解析带时间戳的 agent 日志", () => {
    const result = parseAgentLogLines([
      "[2026-04-20T12:00:01.000Z] agent output",
    ]);

    expect(result[0].timestamp).toBe("2026-04-20T12:00:01.000Z");
    expect(result[0].message).toBe("agent output");
  });

  it("能够按时间合并 system 和 agent 日志", () => {
    const result = mergeSessionLogs(
      parseSystemLogLines(["[2026-04-20T12:00:02.000Z] [INFO] after"]),
      parseAgentLogLines(["[2026-04-20T12:00:01.000Z] before"]),
    );

    expect(result).toHaveLength(2);
    expect(result[0].source).toBe("agent");
    expect(result[0].message).toBe("before");
    expect(result[1].source).toBe("system");
  });

  it("能将 403 insufficient balance 归类为 auth/billing", () => {
    fileMap.set(paths.getLogFile(), "[2026-04-20T12:00:00.000Z] [ERROR] Agent 退出\n");
    fileMap.set(
      paths.getAgentLogFile(),
      "Starting at Mon Apr 20 20:30:30 CST 2026\nFailed to authenticate. API Error: 403 insufficient balance\n",
    );

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
