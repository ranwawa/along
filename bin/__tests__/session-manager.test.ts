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
  },
}));

vi.mock("../db", () => ({
  readSession: vi.fn(),
  upsertSession: vi.fn(() => ({ success: true })),
}));

// Mock common dependencies
vi.mock("../common", () => ({
  iso_timestamp: () => "2026-04-11T12:00:00.000Z",
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
}));

import fs from "fs";
import { readSession, upsertSession } from "../db";
import { SessionManager } from "../session-manager";

describe("session-manager.ts", () => {
  const owner = "ranwawa";
  const repo = "along";
  const issueNumber = 42;
  let sm: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    sm = new SessionManager(owner, repo, issueNumber);
    vi.mocked(upsertSession).mockReturnValue({ success: true } as any);
  });

  describe("writeStatus()", () => {
    it("首次写入时设置默认值", () => {
      vi.mocked(readSession).mockReturnValue({ success: true, data: null } as any);

      sm.writeStatus({ title: "Test Issue" });
      expect(upsertSession).toHaveBeenCalledWith(
        owner,
        repo,
        issueNumber,
        expect.objectContaining({
          status: "running",
          title: "Test Issue",
        })
      );
    });
  });

  describe("updateStep()", () => {
    it("添加新步骤到历史记录", () => {
      vi.mocked(readSession).mockReturnValue({
        success: true,
        data: { status: "running", stepHistory: [] },
      } as any);

      sm.updateStep("分析代码", "开始分析");
      expect(upsertSession).toHaveBeenCalledWith(
        owner,
        repo,
        issueNumber,
        expect.objectContaining({
          currentStep: "分析代码",
          stepHistory: expect.arrayContaining([
            expect.objectContaining({ step: "分析代码" }),
          ]),
        })
      );
    });

    it("关闭上一个步骤的 endTime", () => {
      vi.mocked(readSession).mockReturnValue({
        success: true,
        data: {
          status: "running",
          stepHistory: [
            { step: "Step 1", startTime: "2026-01-01T00:00:00Z" },
          ],
        },
      } as any);

      sm.updateStep("Step 2");
      const calls = vi.mocked(upsertSession).mock.calls;
      const updateData = calls[0][3] as any;
      expect(updateData.stepHistory[0].endTime).toBeTruthy();
      expect(updateData.stepHistory[1].step).toBe("Step 2");
    });
  });

  describe("log()", () => {
    it("追加日志到文件", () => {
      sm.log("test message", "info");
      expect(fs.appendFileSync).toHaveBeenCalled();
    });
  });
});
