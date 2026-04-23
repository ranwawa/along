import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external deps
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

vi.mock("consola", () => ({
  consola: {
    withTag: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn(() => ({
      write: vi.fn(),
      end: vi.fn(),
      destroyed: false,
    })),
  },
}));

const { mockWriteSession } = vi.hoisted(() => ({
  mockWriteSession: vi.fn(),
}));

vi.mock("../log-writer", () => ({
  logWriter: {
    writeSession: mockWriteSession,
    writeGlobal: vi.fn(),
    flush: vi.fn(),
  },
}));

vi.mock("../db", () => ({
  readSession: vi.fn(),
  upsertSession: vi.fn(() => ({ success: true })),
  transactSession: vi.fn(),
}));

vi.mock("../github-client", () => ({
  syncLifecycleLabel: vi.fn(() => Promise.resolve()),
}));

// Mock common dependencies
vi.mock("../common", () => ({
  iso_timestamp: () => "2026-04-11T12:00:00.000Z",
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
}));

import fs from "fs";
import { readSession, upsertSession, transactSession } from "../db";
import { SessionManager } from "../session-manager";

describe("session-manager.ts", () => {
  const owner = "ranwawa";
  const repo = "along";
  const issueNumber = 42;
  let sm: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    sm = new SessionManager(owner, repo, issueNumber);
    (upsertSession as any).mockReturnValue({ success: true } as any);
    (transactSession as any).mockImplementation((mockOwner: string, mockRepo: string, mockIssueNumber: number, modifier: any) => {
      const currentRes = (readSession as any)(mockOwner, mockRepo, mockIssueNumber);
      const update = modifier(currentRes?.data ?? null);
      return (upsertSession as any)(mockOwner, mockRepo, mockIssueNumber, update);
    });
  });

  describe("writeStatus()", () => {
    it("首次写入时设置默认值", () => {
      (readSession as any).mockReturnValue({ success: true, data: null } as any);

      sm.writeStatus({ title: "Test Issue" });
      expect(upsertSession).toHaveBeenCalledWith(
        owner,
        repo,
        issueNumber,
        expect.objectContaining({
          lifecycle: "running",
          phase: "planning",
          step: "read_issue",
          title: "Test Issue",
        })
      );
    });
  });

  describe("updateStep()", () => {
    it("更新当前步骤和消息", async () => {
      (readSession as any).mockReturnValue({
        success: true,
        data: { lifecycle: "running", phase: "planning", step: "read_issue", context: { issueNumber } },
      } as any);

      await sm.updateStep("analyze_codebase" as any, "开始分析");
      expect(upsertSession).toHaveBeenCalledWith(
        owner,
        repo,
        issueNumber,
        expect.objectContaining({
          lifecycle: "running",
          phase: "planning",
          step: "analyze_codebase",
          message: "开始分析",
        })
      );
    });
  });

  describe("log()", () => {
    it("追加日志到文件", () => {
      sm.log("test message", "info");
      expect(mockWriteSession).toHaveBeenCalledWith(
        { owner, repo, issueNumber },
        expect.objectContaining({
          category: "lifecycle",
          source: "session-manager",
          level: "info",
          message: "test message",
        }),
      );
    });
  });
});
