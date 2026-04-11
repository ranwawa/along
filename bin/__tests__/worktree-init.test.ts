import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../common", () => ({
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
  git: {
    raw: vi.fn(),
    fetch: vi.fn(),
  },
}));

vi.mock("../config", () => ({
  config: {
    ROOT_DIR: "/mock/along",
    EDITORS: [{ id: "opencode", name: "OpenCode", mappings: [] }],
    getLogTag: vi.fn(() => ({ success: true, data: "opencode" })),
  },
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
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

vi.mock("../db", () => ({
  upsertSession: vi.fn(() => ({ success: true })),
}));

// Now that we fixed the source code syntax, we can import it properly!
import { getDefaultBranch, setupWorktree } from "../worktree-init";
import { git } from "../common";
import fs from "fs";

describe("worktree-init.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  describe("getDefaultBranch()", () => {
    it("解析成功", async () => {
      vi.mocked(git.raw).mockResolvedValue("HEAD branch: main\n");
      const result = await getDefaultBranch();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe("main");
    });
  });

  describe("setupWorktree()", () => {
    it("目录已存在且有标记时返回成功", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const result = await setupWorktree("/mock/path");
      expect(result.success).toBe(true);
    });
  });
});
