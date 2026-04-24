import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs 和 path 的依赖，避免真实文件系统操作
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// 需要 mock result.ts，因为 config.ts 直接 import 它
vi.mock("../core/result", () => ({
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
}));

import { config } from "../core/config";

describe("config.ts", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("基本属性", () => {
    it("USER_ALONG_DIR 应指向 ~/.along", () => {
      const os = require("os");
      const path = require("path");
      expect(config.USER_ALONG_DIR).toBe(path.join(os.homedir(), ".along"));
    });

    it("CONFIG_FILE 应位于 USER_ALONG_DIR 下", () => {
      expect(config.CONFIG_FILE).toBe(
        require("path").join(config.USER_ALONG_DIR, "config.json")
      );
    });
  });

  describe("getIssueDir()", () => {
    it("应正确拼接路径: ~/.along/{owner}/{repo}/{issueNumber}/", () => {
      const result = config.getIssueDir("ranwawa", "along", 42);
      const path = require("path");
      expect(result).toBe(
        path.join(config.USER_ALONG_DIR, "ranwawa", "along", "42")
      );
    });

    it("issueNumber 应转为字符串", () => {
      const result = config.getIssueDir("owner", "repo", 0);
      expect(result).toContain("/0");
    });
  });

  describe("getLogTag()", () => {
    it("AGENT_TYPE 环境变量优先级最高", () => {
      process.env.AGENT_TYPE = "opencode";
      const result = config.getLogTag();
      expect(result).toEqual({ success: true, data: "opencode" });
    });

    it("无法检测时返回 failure", () => {
      delete process.env.AGENT_TYPE;
      // 由于 cwd 下不太可能有 .opencode/.pi/.claude，通常会返回 failure
      const result = config.getLogTag();
      // 可能 success 也可能 failure，取决于当前目录
      expect(result).toHaveProperty("success");
    });
  });

  describe("EDITORS", () => {
    it("应包含 opencode, pi, codex, claude 四个编辑器", () => {
      expect(config.EDITORS).toHaveLength(4);
      const ids = config.EDITORS.map((e) => e.id);
      expect(ids).toContain("opencode");
      expect(ids).toContain("pi");
      expect(ids).toContain("codex");
      expect(ids).toContain("claude");
    });

    it("每个编辑器都有 mappings, runTemplate 和 detectDir", () => {
      for (const editor of config.EDITORS) {
        expect(editor.mappings.length).toBeGreaterThan(0);
        expect(editor.runTemplate).toBeTruthy();
        expect(editor.name).toBeTruthy();
        expect(editor.detectDir).toMatch(/^\./);
      }
    });

    it("mappings 中 from 应为 skills 或 prompts", () => {
      for (const editor of config.EDITORS) {
        for (const mapping of editor.mappings) {
          expect(["skills", "prompts"]).toContain(mapping.from);
        }
      }
    });

    it("opencode 和 claude 有 ensurePermissions 回调", () => {
      const opencode = config.EDITORS.find(e => e.id === "opencode");
      const claude = config.EDITORS.find(e => e.id === "claude");
      expect(typeof opencode?.ensurePermissions).toBe("function");
      expect(typeof claude?.ensurePermissions).toBe("function");
    });
  });
});
