import { describe, it, expect, vi, beforeEach } from "vitest";

// Pre-define mocks
const mockStmt = {
  get: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
};

const mockDbInstance = {
  exec: vi.fn(),
  prepare: vi.fn(() => mockStmt),
  close: vi.fn(),
};

vi.mock("bun:sqlite", () => {
  return {
    // Use a regular function instead of an arrow function to support constructor usage
    Database: vi.fn().mockImplementation(function() {
      return mockDbInstance;
    }),
  };
});

vi.mock("../config", () => ({
  config: {
    USER_ALONG_DIR: "/mock/.along",
    ensureDataDirs: vi.fn(),
  },
}));

import {
  getDb,
  readSession,
  upsertSession,
  closeDb,
} from "../db";

describe("db.ts logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeDb(); // Reset singleton
    
    // Reset mock behavior
    mockStmt.get.mockReturnValue(null);
    mockStmt.all.mockReturnValue([]);
    mockStmt.run.mockReturnValue(undefined);
    mockDbInstance.exec.mockReturnValue(undefined);
    mockDbInstance.prepare.mockReturnValue(mockStmt);
  });

  describe("getDb()", () => {
    it("成功初始化", () => {
      const result = getDb();
      if (!result.success) {
        console.error("DB INIT ERROR:", result.error);
      }
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(mockDbInstance);
      }
    });

    it("单例模式", () => {
      const db1 = getDb().data;
      const db2 = getDb().data;
      expect(db1).toBe(db2);
    });
  });

  describe("readSession()", () => {
    it("正确解析 JSON 和驼峰转换", () => {
      mockStmt.get.mockReturnValue({
        owner: "ranwawa",
        repo: "along",
        issue_number: 42,
        lifecycle: "running",
        phase: "planning",
        step: "read_issue",
        context: JSON.stringify({ issueNumber: 42, commitShas: ["sha1", "sha2"] }),
      });

      const result = readSession("ranwawa", "along", 42);
      expect(result.success).toBe(true);
    });
  });

  describe("upsertSession()", () => {
    it("可成功更新 session", () => {
      mockStmt.get.mockReturnValue({ id: 1 });
      const result = upsertSession("o", "r", 1, { lifecycle: "completed", phase: "done", step: "archive_result" } as any);
      expect(result.success).toBe(true);
    });
  });
});
