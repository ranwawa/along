import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync, spawnSync } from "child_process";

// Mock common.ts 的 re-exports
vi.mock("../common", () => ({
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
}));

vi.mock("child_process", () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

import { runCommand, runSafeCommand } from "../exec";

describe("exec.ts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("runCommand()", () => {
    it("成功时返回 trimmed stdout", () => {
      vi.mocked(execSync).mockReturnValue("  hello world  \n");
      const result = runCommand("echo hello");
      expect(result).toEqual({ success: true, data: "hello world" });
      expect(execSync).toHaveBeenCalledWith("echo hello", {
        encoding: "utf-8",
        stdio: "pipe",
      });
    });

    it("失败时返回 stderr 错误信息", () => {
      vi.mocked(execSync).mockImplementation(() => {
        const err: any = new Error("command failed");
        err.stderr = "permission denied";
        throw err;
      });
      const result = runCommand("bad-command");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("permission denied");
      }
    });

    it("无 stderr 时 fallback 到 error.message", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("something went wrong");
      });
      const result = runCommand("bad-command");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("something went wrong");
      }
    });
  });

  describe("runSafeCommand()", () => {
    it("成功时返回 trimmed stdout", () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        stdout: "  output  \n",
        stderr: "",
        error: undefined as any,
        pid: 123,
        signal: null,
        output: [],
      });
      const result = runSafeCommand("echo", ["hello"]);
      expect(result).toEqual({ success: true, data: "output" });
    });

    it("spawn error 时返回 failure", () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: null,
        stdout: "",
        stderr: "",
        error: new Error("ENOENT") as any,
        pid: 0,
        signal: null,
        output: [],
      });
      const result = runSafeCommand("nonexistent", []);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("ENOENT");
      }
    });

    it("非零退出码时返回 stderr", () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "  error output  \n",
        error: undefined as any,
        pid: 123,
        signal: null,
        output: [],
      });
      const result = runSafeCommand("failing", ["cmd"]);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("error output");
      }
    });

    it("非零退出码但无 stderr 时显示状态码", () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 127,
        stdout: "",
        stderr: "",
        error: undefined as any,
        pid: 123,
        signal: null,
        output: [],
      });
      const result = runSafeCommand("missing", ["cmd"]);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Command failed with status 127");
      }
    });
  });
});
