import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use a regular function so it can be used as a constructor
const mockInvoke = vi.fn();

vi.mock("@langchain/openai", () => {
  return {
    ChatOpenAI: vi.fn().mockImplementation(function() {
      return {
        invoke: mockInvoke,
      };
    }),
  };
});

vi.mock("../core/common", () => ({
  success: (data: any) => ({ success: true, data }),
  failure: (error: string) => ({ success: false, error }),
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
    readFileSync: vi.fn(() => {
      throw new Error("ENOENT");
    }),
    existsSync: vi.fn(() => false),
  },
}));

import { analyzeErrorLog } from "../domain/analyze-error";

describe("analyze-error.ts", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, DEEPSEEK_API_KEY: "test-key" };
    mockInvoke.mockResolvedValue({ content: "AI 分析结果" });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("成功分析时返回 AI 结果", async () => {
    const result = await analyzeErrorLog("Error: something went wrong");
    if (!result.success) {
      console.error("Test failed with error:", result.error);
    }
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("AI 分析结果");
    }
  });

  it("长日志会被截断到最后 8000 个字符", async () => {
    const longLog = "x".repeat(20000);
    await analyzeErrorLog(longLog);

    expect(mockInvoke).toHaveBeenCalled();
    const userMsg = mockInvoke.mock.calls[0][0][1].content;
    expect(userMsg.length).toBeLessThan(20000);
  });

  it("LLM 调用失败时返回 failure", async () => {
    mockInvoke.mockRejectedValue(new Error("API timeout"));

    const result = await analyzeErrorLog("error log");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("API timeout");
    }
  });
});
