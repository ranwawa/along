import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../common", () => ({
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
}));

vi.mock("../github-client", () => ({
  get_gh_client: vi.fn(),
}));

import { Issue } from "../issue";

describe("issue.ts", () => {
  describe("checkHealth()", () => {
    it("data 未加载时返回 failure", () => {
      const issue = new Issue(42, {});
      const result = issue.checkHealth();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("尚未加载");
      }
    });

    it("issue 已关闭时返回 failure", () => {
      const issue = new Issue(42, {});
      issue.data = { state: "closed", labels: [] } as any;
      const result = issue.checkHealth();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("closed");
      }
    });

    it("open 且无 WIP 标签时返回 success", () => {
      const issue = new Issue(42, {});
      issue.data = { state: "open", labels: [{ name: "bug" }] } as any;
      const result = issue.checkHealth();
      expect(result.success).toBe(true);
    });

    it("有 WIP 标签时返回 failure", () => {
      const issue = new Issue(42, {});
      issue.data = { state: "open", labels: [{ name: "WIP" }] } as any;
      const result = issue.checkHealth();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("WIP");
      }
    });

    it("WIP 标签大小写不敏感（wip）", () => {
      const issue = new Issue(42, {});
      issue.data = { state: "open", labels: [{ name: "wip" }] } as any;
      const result = issue.checkHealth();
      expect(result.success).toBe(false);
    });

    it("skipWipCheck=true 时跳过 WIP 检查", () => {
      const issue = new Issue(42, {});
      issue.data = { state: "open", labels: [{ name: "WIP" }] } as any;
      const result = issue.checkHealth({ skipWipCheck: true });
      expect(result.success).toBe(true);
    });

    it("标签为纯字符串格式时也能正确检测 WIP", () => {
      const issue = new Issue(42, {});
      issue.data = { state: "open", labels: ["WIP"] } as any;
      const result = issue.checkHealth();
      expect(result.success).toBe(false);
    });
  });
});
