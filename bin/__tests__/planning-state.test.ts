import { describe, expect, it, vi } from "vitest";

const mockStmt = {
  get: () => null,
  all: () => [],
  run: () => undefined,
};

const mockDbInstance = {
  exec: () => undefined,
  prepare: () => mockStmt,
  close: () => undefined,
};

vi.mock("bun:sqlite", () => {
  return {
    Database: vi.fn().mockImplementation(function () {
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
  inferAuthorType,
  isHumanFeedbackComment,
  isSystemPlanningComment,
  parseApprovalCommand,
  type CommentMirrorRecord,
} from "../planning-state";

function createComment(body: string): CommentMirrorRecord {
  return {
    owner: "o",
    repo: "r",
    issueNumber: 1,
    commentId: 1,
    authorLogin: "alice",
    authorType: "human",
    body,
    createdAt: "2026-04-20T12:00:00.000Z",
    mirroredAt: "2026-04-20T12:00:01.000Z",
  };
}

describe("planning-state.ts", () => {
  it("识别系统 planning 评论元数据", () => {
    const body =
      '<!-- along:plan {"planId":"plan_123","version":1} -->\n## Plan v1';

    expect(isSystemPlanningComment(body)).toBe(true);
    expect(inferAuthorType("User", "alice", body)).toBe("bot");
    expect(isHumanFeedbackComment(createComment(body))).toBe(false);
  });

  it("只将普通人类评论视为 feedback", () => {
    expect(
      isHumanFeedbackComment(createComment("前端不要轮询，接口失败要重试")),
    ).toBe(true);
    expect(isHumanFeedbackComment(createComment("/approve v2"))).toBe(false);
    expect(isHumanFeedbackComment(createComment("/reject"))).toBe(false);
  });

  it("解析 approve 指令目标", () => {
    expect(parseApprovalCommand("/approve")).toEqual({ mode: "implicit" });
    expect(parseApprovalCommand("/approve v2")).toEqual({
      mode: "version",
      version: 2,
    });
    expect(parseApprovalCommand("/approve plan:plan_abc123")).toEqual({
      mode: "planId",
      planId: "plan_abc123",
    });
    expect(parseApprovalCommand("/approve latest")).toBeNull();
  });
});
