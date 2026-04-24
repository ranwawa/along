import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock 外部依赖
vi.mock("../core/config", () => ({
  config: {
    USER_ALONG_DIR: "/mock/.along",
    getLogTag: vi.fn(() => ({ success: true, data: "opencode" })),
  },
}));

vi.mock("../core/result", () => ({
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
  Result: {},
}));

// Mock simple-git (通过 createRequire)
vi.mock("module", () => ({
  createRequire: () => () => ({
    simpleGit: () => ({
      checkIsRepo: vi.fn().mockResolvedValue(true),
      revparse: vi.fn().mockResolvedValue("/mock/repo\n"),
    }),
  }),
}));

vi.mock("consola", () => ({
  consola: {
    withTag: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

import { calculate_runtime, iso_timestamp, check_process_running } from "../core/common";

describe("common.ts", () => {
  describe("calculate_runtime()", () => {
    it("不到 1 分钟时显示秒数", () => {
      const now = new Date();
      const start = new Date(now.getTime() - 30 * 1000).toISOString();
      const result = calculate_runtime(start);
      expect(result).toMatch(/^\d+s$/);
    });

    it("1-60 分钟时显示分钟数", () => {
      const now = new Date();
      const start = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
      const result = calculate_runtime(start);
      expect(result).toMatch(/^\d+m$/);
    });

    it("超过 1 小时时显示小时和分钟", () => {
      const now = new Date();
      const start = new Date(now.getTime() - 90 * 60 * 1000).toISOString();
      const result = calculate_runtime(start);
      expect(result).toMatch(/^\d+h\d+m$/);
    });

    it("无效输入返回「未知」", () => {
      expect(calculate_runtime("invalid-date")).toBe("未知");
      expect(calculate_runtime("")).toBe("未知");
    });
  });

  describe("iso_timestamp()", () => {
    it("返回 ISO 8601 格式的时间戳", () => {
      const result = iso_timestamp();
      // ISO 格式: 2026-04-11T05:00:00.000Z
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("时间戳接近当前时间", () => {
      const before = Date.now();
      const result = iso_timestamp();
      const after = Date.now();
      const ts = new Date(result).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  describe("check_process_running()", () => {
    it("PID 为空时返回 false", async () => {
      expect(await check_process_running(0)).toBe(false);
      expect(await check_process_running("" as any)).toBe(false);
    });

    it("当前进程 PID 应返回 true", async () => {
      const result = await check_process_running(process.pid);
      expect(result).toBe(true);
    });

    it("不存在的 PID 返回 false", async () => {
      // 使用一个极大的 PID，几乎不可能存在
      const result = await check_process_running(9999999);
      expect(result).toBe(false);
    });
  });
});
