import { describe, it, expect } from "vitest";
import { success, failure, type Result } from "../result";

describe("result.ts", () => {
  describe("success()", () => {
    it("应返回 success=true 和 data", () => {
      const result = success(42);
      expect(result).toEqual({ success: true, data: 42 });
    });

    it("支持复杂对象作为 data", () => {
      const obj = { name: "test", items: [1, 2, 3] };
      const result = success(obj);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(obj);
      }
    });

    it("支持 null/undefined 作为 data", () => {
      expect(success(null)).toEqual({ success: true, data: null });
      expect(success(undefined)).toEqual({ success: true, data: undefined });
    });
  });

  describe("failure()", () => {
    it("应返回 success=false 和 error 消息", () => {
      const result = failure("出错了");
      expect(result).toEqual({ success: false, error: "出错了", stack: undefined });
    });

    it("支持可选的 stack 参数", () => {
      const result = failure("出错了", "Error\n  at test.ts:1");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("出错了");
        expect(result.stack).toBe("Error\n  at test.ts:1");
      }
    });

    it("不传 stack 时 stack 为 undefined", () => {
      const result = failure("msg");
      if (!result.success) {
        expect(result.stack).toBeUndefined();
      }
    });
  });

  describe("类型窄化", () => {
    it("success 分支可以访问 data", () => {
      const result: Result<string> = success("hello");
      if (result.success) {
        // 类型窄化后能访问 data
        expect(result.data).toBe("hello");
      } else {
        // 不应进入此分支
        expect.unreachable();
      }
    });

    it("failure 分支可以访问 error", () => {
      const result: Result<string> = failure("err");
      if (!result.success) {
        expect(result.error).toBe("err");
      } else {
        expect.unreachable();
      }
    });
  });
});
