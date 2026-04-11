import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../common", () => ({
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
  iso_timestamp: () => "2026-04-11T12:00:00.000Z",
}));

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
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

vi.mock("../db", () => ({
  readSession: vi.fn(),
  upsertSession: vi.fn(),
}));

import { Task } from "../task";
import fs from "fs";
import { readSession } from "../db";

describe("task.ts", () => {
  const owner = "ranwawa";
  const repo = "along";

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 mock: db 中无 session，文件系统无 todo 和 worktree
    vi.mocked(readSession).mockReturnValue({ success: true, data: null } as any);
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  describe("构造函数", () => {
    it("基本属性应正确设置", () => {
      const task = new Task(owner, repo, 42);
      expect(task.taskNumber).toBe(42);
      expect(task.owner).toBe(owner);
      expect(task.repo).toBe(repo);
    });
  });

  describe("notExists()", () => {
    it("无 status/todo/worktree 时返回 true", () => {
      const task = new Task(owner, repo, 42);
      expect(task.notExists()).toBe(true);
    });

    it("有 worktree 时返回 false", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes("worktree"));
      const task = new Task(owner, repo, 42);
      expect(task.notExists()).toBe(false);
    });
  });

  describe("readToDo() - parseToDoMarkdown", () => {
    it("解析标准 todo 格式", () => {
      const todoContent = `- [ ] 第一步：理解 Issue
- [x] 第二步：分析代码
- [/] 第三步：实施修复
- [ ] 第四步：提交代码
- [ ] 第五步：创建 PR`;

      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        return String(p).endsWith("todo.md");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(todoContent);

      const task = new Task(owner, repo, 42);
      expect(task.todo).not.toBeNull();
      expect(task.todo.items).toHaveLength(5);

      // 检查状态解析
      expect(task.todo.items[0].status).toBe("todo");
      expect(task.todo.items[0].completed).toBe(false);

      expect(task.todo.items[1].status).toBe("done");
      expect(task.todo.items[1].completed).toBe(true);

      expect(task.todo.items[2].status).toBe("running");
      expect(task.todo.items[2].completed).toBe(false);
    });

    it("当前步骤为第一个未完成项", () => {
      const todoContent = `- [x] 步骤1
- [ ] 步骤2
- [ ] 步骤3`;

      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        return String(p).endsWith("todo.md");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(todoContent);

      const task = new Task(owner, repo, 42);
      expect(task.todo.currentStep).toBe("步骤2");
    });

    it("全部完成时 currentStep 为「已完成」", () => {
      const todoContent = `- [x] 步骤1
- [x] 步骤2`;

      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        return String(p).endsWith("todo.md");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(todoContent);

      const task = new Task(owner, repo, 42);
      expect(task.todo.currentStep).toBe("已完成");
    });
  });

  describe("checkHealth()", () => {
    it("running 状态无 worktree 时返回 failure", () => {
      vi.mocked(readSession).mockReturnValue({
        success: true,
        data: { status: "running" } as any,
      } as any);
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const task = new Task(owner, repo, 42);
      const result = task.checkHealth();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("没有worktree");
      }
    });

    it("无数据时返回 success", () => {
      vi.mocked(readSession).mockReturnValue({ success: true, data: null } as any);
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const task = new Task(owner, repo, 42);
      const result = task.checkHealth();
      expect(result.success).toBe(true);
    });
  });
});
