import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockShell } = vi.hoisted(() => ({
  mockShell: vi.fn(),
}));

vi.mock("bun", () => ({
  $: mockShell,
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

vi.mock("../config", () => ({
  config: {
    USER_ALONG_DIR: "/mock/.along",
    getIssueDir: (owner: string, repo: string, issueNumber: number) =>
      `/mock/.along/${owner}/${repo}/${issueNumber}`,
    getLogTag: vi.fn(() => ({ success: true, data: "along" })),
  },
}));

vi.mock("../common", () => ({
  check_process_running: vi.fn(),
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
}));

vi.mock("../github-client", () => ({
  get_gh_client: vi.fn(),
  readRepoInfo: vi.fn(),
}));

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => false),
    rmSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
  },
}));

vi.mock("../db", () => ({
  readSession: vi.fn(),
  upsertSession: vi.fn(() => ({ success: true })),
  deleteSession: vi.fn(() => ({ success: true })),
  transactSession: vi.fn(),
}));

vi.mock("../session-state-machine", () => ({
  isActiveSessionStatus: vi.fn(),
}));

vi.mock("../session-paths", () => {
  return {
    SessionPathManager: class {
      private owner: string;
      private repo: string;
      private issueNumber: number;
      constructor(owner: string, repo: string, issueNumber: number) {
        this.owner = owner;
        this.repo = repo;
        this.issueNumber = issueNumber;
      }
      getWorktreeDir() { return `/mock/.along/${this.owner}/${this.repo}/${this.issueNumber}/worktree`; }
      getIssueDir() { return `/mock/.along/${this.owner}/${this.repo}/${this.issueNumber}`; }
    },
  };
});

vi.mock("../session-manager", () => {
  return {
    SessionManager: class {
      logEvent = vi.fn();
    },
  };
});

import fs from "fs";
import { check_process_running } from "../common";
import { readSession, deleteSession } from "../db";
import { isActiveSessionStatus } from "../session-state-machine";
import { get_gh_client, readRepoInfo } from "../github-client";
import {
  checkAndKillProcess,
  cleanupWorktree,
  cleanupBranch,
  readBranchName,
  cleanupIssue,
  cleanupIssueAssets,
} from "../cleanup-utils";

const owner = "ranwawa";
const repo = "along";
const issueNumber = 42;

describe("cleanup-utils.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShell.mockReset();
  });

  describe("checkAndKillProcess()", () => {
    it("readSession 失败时返回 canProceed: false", async () => {
      (readSession as any).mockReturnValue({ success: false, error: "db error" });

      const result = await checkAndKillProcess(owner, repo, issueNumber, {});
      expect(result).toEqual({ canProceed: false, error: "db error" });
    });

    it("会话不存在时返回 canProceed: true", async () => {
      (readSession as any).mockReturnValue({ success: true, data: null });

      const result = await checkAndKillProcess(owner, repo, issueNumber, {});
      expect(result).toEqual({ canProceed: true });
    });

    it("会话非活跃状态时返回 canProceed: true", async () => {
      (readSession as any).mockReturnValue({
        success: true,
        data: { lifecycle: "completed", pid: 1234 },
      });
      (isActiveSessionStatus as any).mockReturnValue(false);

      const result = await checkAndKillProcess(owner, repo, issueNumber, {});
      expect(result).toEqual({ canProceed: true });
    });

    it("进程不在运行时返回 canProceed: true", async () => {
      (readSession as any).mockReturnValue({
        success: true,
        data: { lifecycle: "running", pid: 1234 },
      });
      (isActiveSessionStatus as any).mockReturnValue(true);
      (check_process_running as any).mockResolvedValue(false);

      const result = await checkAndKillProcess(owner, repo, issueNumber, {});
      expect(result).toEqual({ canProceed: true });
    });

    it("pid 为 0 时返回 canProceed: true", async () => {
      (readSession as any).mockReturnValue({
        success: true,
        data: { lifecycle: "running", pid: 0 },
      });
      (isActiveSessionStatus as any).mockReturnValue(true);

      const result = await checkAndKillProcess(owner, repo, issueNumber, {});
      expect(result).toEqual({ canProceed: true });
    });

    it("进程运行中且非 force 时返回 canProceed: false 及错误信息", async () => {
      (readSession as any).mockReturnValue({
        success: true,
        data: { lifecycle: "running", pid: 1234 },
      });
      (isActiveSessionStatus as any).mockReturnValue(true);
      (check_process_running as any).mockResolvedValue(true);

      const result = await checkAndKillProcess(owner, repo, issueNumber, { force: false });
      expect(result.canProceed).toBe(false);
      expect(result.error).toContain("仍在运行中");
      expect(result.error).toContain("1234");
    });

    it("进程运行中且 force 时终止进程并返回 canProceed: true", async () => {
      (readSession as any).mockReturnValue({
        success: true,
        data: { lifecycle: "running", pid: 99999 },
      });
      (isActiveSessionStatus as any).mockReturnValue(true);
      (check_process_running as any).mockResolvedValue(true);

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

      const result = await checkAndKillProcess(owner, repo, issueNumber, { force: true });
      expect(result).toEqual({ canProceed: true });
      expect(killSpy).toHaveBeenCalledWith(99999, 9);

      killSpy.mockRestore();
    });

    it("force 终止进程失败时仍返回 canProceed: true", async () => {
      (readSession as any).mockReturnValue({
        success: true,
        data: { lifecycle: "running", pid: 99999 },
      });
      (isActiveSessionStatus as any).mockReturnValue(true);
      (check_process_running as any).mockResolvedValue(true);

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("ESRCH");
      });

      const result = await checkAndKillProcess(owner, repo, issueNumber, { force: true });
      expect(result).toEqual({ canProceed: true });

      killSpy.mockRestore();
    });
  });

  describe("cleanupWorktree()", () => {
    it("worktree 不存在且不在 git worktree list 中时跳过", async () => {
      (fs.existsSync as any).mockReturnValue(false);
      mockShell.mockImplementation((strings: TemplateStringsArray) => {
        const cmd = strings[0];
        if (cmd.includes("git worktree list")) {
          return { text: () => Promise.resolve("/some/other/path") };
        }
        return { quiet: () => ({ nothrow: () => Promise.resolve() }) };
      });

      await cleanupWorktree("/mock/worktree");
    });

    it("正常删除 worktree", async () => {
      (fs.existsSync as any).mockReturnValue(true);
      const quietMock = vi.fn().mockResolvedValue(undefined);
      mockShell.mockImplementation((strings: TemplateStringsArray) => {
        const cmd = strings[0];
        if (cmd.includes("git worktree list")) {
          return { text: () => Promise.resolve("/mock/worktree") };
        }
        if (cmd.includes("git worktree remove")) {
          return { quiet: () => quietMock() };
        }
        return { quiet: () => Promise.resolve() };
      });

      await cleanupWorktree("/mock/worktree");
    });

    it("git worktree remove 失败时回退到 rm -rf", async () => {
      (fs.existsSync as any).mockReturnValue(true);
      mockShell.mockImplementation((strings: TemplateStringsArray) => {
        const cmd = strings[0];
        if (cmd.includes("git worktree list")) {
          return { text: () => Promise.resolve("/mock/worktree") };
        }
        if (cmd.includes("git worktree remove")) {
          return { quiet: () => Promise.reject(new Error("locked")) };
        }
        return Promise.resolve();
      });

      await cleanupWorktree("/mock/worktree");
    });
  });

  describe("cleanupBranch()", () => {
    it("分支名为空时跳过", async () => {
      await cleanupBranch("");
      expect(mockShell).not.toHaveBeenCalled();
    });

    it("分支存在时删除", async () => {
      const nothrowMock = vi.fn().mockResolvedValue(undefined);
      mockShell.mockImplementation((strings: TemplateStringsArray) => {
        const cmd = strings[0];
        if (cmd.includes("git branch --list")) {
          return { text: () => Promise.resolve("  fix/issue-42\n") };
        }
        if (cmd.includes("git branch -D")) {
          return { quiet: () => ({ nothrow: () => nothrowMock() }) };
        }
        return { text: () => Promise.resolve("") };
      });

      await cleanupBranch("fix/issue-42");
    });

    it("分支不存在时跳过删除", async () => {
      mockShell.mockImplementation(() => ({
        text: () => Promise.resolve(""),
      }));

      await cleanupBranch("fix/issue-42");
    });
  });

  describe("readBranchName()", () => {
    it("会话存在时返回分支名", () => {
      (readSession as any).mockReturnValue({
        success: true,
        data: { context: { branchName: "fix/issue-42-desc" } },
      });

      expect(readBranchName(owner, repo, issueNumber)).toBe("fix/issue-42-desc");
    });

    it("会话不存在时返回空字符串", () => {
      (readSession as any).mockReturnValue({ success: true, data: null });
      expect(readBranchName(owner, repo, issueNumber)).toBe("");
    });

    it("readSession 失败时返回空字符串", () => {
      (readSession as any).mockReturnValue({ success: false, error: "db error" });
      expect(readBranchName(owner, repo, issueNumber)).toBe("");
    });

    it("context 中无 branchName 时返回空字符串", () => {
      (readSession as any).mockReturnValue({
        success: true,
        data: { context: {} },
      });
      expect(readBranchName(owner, repo, issueNumber)).toBe("");
    });
  });

  describe("cleanupIssue()", () => {
    beforeEach(() => {
      (readSession as any).mockReturnValue({
        success: true,
        data: { lifecycle: "completed", context: { branchName: "fix/issue-42" } },
      });
      (isActiveSessionStatus as any).mockReturnValue(false);
      (deleteSession as any).mockReturnValue({ success: true });
      (fs.existsSync as any).mockReturnValue(false);
      mockShell.mockImplementation((strings: TemplateStringsArray) => {
        const cmd = strings[0];
        if (cmd.includes("git worktree list")) {
          return { text: () => Promise.resolve("") };
        }
        if (cmd.includes("git branch --list")) {
          return { text: () => Promise.resolve("") };
        }
        return { text: () => Promise.resolve(""), quiet: () => Promise.resolve() };
      });
    });

    it("未传入 owner/repo 时从 git remote 获取", async () => {
      (readRepoInfo as any).mockResolvedValue({
        success: true,
        data: { owner: "ranwawa", repo: "along" },
      });

      const result = await cleanupIssue("42");
      expect(result.success).toBe(true);
      expect(readRepoInfo).toHaveBeenCalled();
    });

    it("readRepoInfo 失败时返回 failure", async () => {
      (readRepoInfo as any).mockResolvedValue({
        success: false,
        error: "无法获取 git 远程仓库 origin 信息",
      });

      const result = await cleanupIssue("42");
      expect(result.success).toBe(false);
    });

    it("传入 owner/repo 时直接使用", async () => {
      const result = await cleanupIssue("42", {}, owner, repo);
      expect(result.success).toBe(true);
      expect(readRepoInfo).not.toHaveBeenCalled();
    });

    it("进程检查失败时中止", async () => {
      (readSession as any).mockReturnValue({
        success: true,
        data: { lifecycle: "running", pid: 1234 },
      });
      (isActiveSessionStatus as any).mockReturnValue(true);
      (check_process_running as any).mockResolvedValue(true);

      const result = await cleanupIssue("42", { force: false }, owner, repo);
      expect(result.success).toBe(false);
      expect(result.error).toContain("仍在运行中");
    });

    it("deleteSession 失败时返回 failure", async () => {
      (deleteSession as any).mockReturnValue({ success: false, error: "db error" });

      const result = await cleanupIssue("42", {}, owner, repo);
      expect(result.success).toBe(false);
      expect(result.error).toBe("db error");
    });

    it("PR 合并场景下移除 WIP 标签", async () => {
      const mockRemoveLabel = vi.fn().mockResolvedValue({ success: true });
      (get_gh_client as any).mockResolvedValue({
        success: true,
        data: { removeIssueLabel: mockRemoveLabel },
      });

      const result = await cleanupIssue("42", { reason: "pr-merged" }, owner, repo);
      expect(result.success).toBe(true);
      expect(mockRemoveLabel).toHaveBeenCalledWith("42", "WIP");
    });

    it("PR 合并时移除标签失败不影响清理", async () => {
      (get_gh_client as any).mockResolvedValue({
        success: true,
        data: {
          removeIssueLabel: vi.fn().mockRejectedValue(new Error("not found")),
        },
      });

      const result = await cleanupIssue("42", { reason: "pr-merged" }, owner, repo);
      expect(result.success).toBe(true);
    });
  });

  describe("cleanupIssueAssets()", () => {
    beforeEach(() => {
      (readSession as any).mockReturnValue({
        success: true,
        data: {
          lifecycle: "completed",
          worktreePath: "/mock/.along/ranwawa/along/42/worktree",
          context: { branchName: "fix/issue-42" },
        },
      });
      (isActiveSessionStatus as any).mockReturnValue(false);
      (deleteSession as any).mockReturnValue({ success: true });
      (fs.existsSync as any).mockReturnValue(false);
      mockShell.mockImplementation((strings: TemplateStringsArray) => {
        const cmd = strings[0];
        if (cmd.includes("git worktree list")) {
          return { text: () => Promise.resolve("") };
        }
        if (cmd.includes("git branch --list")) {
          return { text: () => Promise.resolve("") };
        }
        return { text: () => Promise.resolve(""), quiet: () => Promise.resolve() };
      });
    });

    it("未传入 owner/repo 时从 git remote 获取", async () => {
      (readRepoInfo as any).mockResolvedValue({
        success: true,
        data: { owner: "ranwawa", repo: "along" },
      });

      const result = await cleanupIssueAssets("42");
      expect(result.success).toBe(true);
      expect(readRepoInfo).toHaveBeenCalled();
    });

    it("readRepoInfo 失败时返回 failure", async () => {
      (readRepoInfo as any).mockResolvedValue({
        success: false,
        error: "无法获取 git 远程仓库 origin 信息",
      });

      const result = await cleanupIssueAssets("42");
      expect(result.success).toBe(false);
    });

    it("readSession 失败时返回 failure", async () => {
      (readSession as any).mockReturnValue({ success: false, error: "db error" });

      const result = await cleanupIssueAssets("42", {}, owner, repo);
      expect(result.success).toBe(false);
      expect(result.error).toBe("db error");
    });

    it("进程检查失败时中止", async () => {
      (readSession as any).mockReturnValue({
        success: true,
        data: { lifecycle: "running", pid: 1234 },
      });
      (isActiveSessionStatus as any).mockReturnValue(true);
      (check_process_running as any).mockResolvedValue(true);

      const result = await cleanupIssueAssets("42", { force: false }, owner, repo);
      expect(result.success).toBe(false);
      expect(result.error).toContain("仍在运行中");
    });

    it("完整清理流程包含数据目录删除", async () => {
      (fs.existsSync as any).mockReturnValue(true);

      const result = await cleanupIssueAssets("42", {}, owner, repo);
      expect(result.success).toBe(true);
      expect(fs.rmSync).toHaveBeenCalledWith(
        `/mock/.along/${owner}/${repo}/42`,
        { recursive: true, force: true },
      );
    });

    it("数据目录不存在时跳过删除", async () => {
      (fs.existsSync as any).mockImplementation((p: string) => {
        if (p.endsWith("/42")) return false;
        return false;
      });

      const result = await cleanupIssueAssets("42", {}, owner, repo);
      expect(result.success).toBe(true);
      expect(fs.rmSync).not.toHaveBeenCalled();
    });

    it("删除数据目录失败时返回 failure", async () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.rmSync as any).mockImplementation(() => {
        throw new Error("EPERM");
      });

      const result = await cleanupIssueAssets("42", {}, owner, repo);
      expect(result.success).toBe(false);
      expect(result.error).toContain("EPERM");
    });

    it("deleteSession 失败时返回 failure", async () => {
      (deleteSession as any).mockReturnValue({ success: false, error: "db error" });

      const result = await cleanupIssueAssets("42", {}, owner, repo);
      expect(result.success).toBe(false);
      expect((result as any).error).toBe("db error");
    });

    it("使用 session 中的 worktreePath 和 branchName", async () => {
      (readSession as any).mockReturnValue({
        success: true,
        data: {
          lifecycle: "completed",
          worktreePath: "/custom/worktree/path",
          context: { branchName: "custom-branch" },
        },
      });

      const result = await cleanupIssueAssets("42", {}, owner, repo);
      expect(result.success).toBe(true);
    });
  });
});
