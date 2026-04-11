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
        status: "running",
        commit_shas: JSON.stringify(["sha1", "sha2"]),
        step_history: "[]",
      });

      const result = readSession("ranwawa", "along", 42);
      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.issueNumber).toBe(42);
        expect(result.data.commitShas).toEqual(["sha1", "sha2"]);
      }
    });
  });

  describe("upsertSession()", () => {
    it("调用 prepare", () => {
      mockStmt.get.mockReturnValue({ id: 1 });
      const result = upsertSession("o", "r", 1, { status: "done" });
      expect(result.success).toBe(true);
      expect(mockDbInstance.prepare).toHaveBeenCalled();
    });
  });
});
