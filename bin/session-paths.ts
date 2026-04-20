import path from "path";
import fs from "fs";
import { config } from "./config";
import { success, failure } from "./result";
import type { Result } from "./result";

/**
 * 统一管理所有 session 相关的路径生成
 * 目录结构: ~/.along/{owner}/{repo}/{issueNumber}/
 *
 * 注意：session 状态数据已迁移至 SQLite (db.ts)，
 * 此模块仅管理文件系统路径（日志、todo、worktree 等）。
 */
export class SessionPathManager {
  private owner: string;
  private repo: string;
  private issueNumber: number;

  constructor(owner: string, repo: string, issueNumber: number) {
    this.owner = owner;
    this.repo = repo;
    this.issueNumber = issueNumber;
  }

  /** issue 级别的数据目录 */
  getIssueDir(): string {
    return config.getIssueDir(this.owner, this.repo, this.issueNumber);
  }

  /** 确保 issue 目录存在 */
  ensureDir(): Result<void> {
    try {
      fs.mkdirSync(this.getIssueDir(), { recursive: true });
      return success(undefined);
    } catch (e: any) {
      return failure(`无法创建目录 ${this.getIssueDir()}: ${e.message}`);
    }
  }

  getTodoFile(): string {
    return path.join(this.getIssueDir(), "todo.md");
  }

  getIssueFile(): string {
    return path.join(this.getIssueDir(), "issue.json");
  }

  getStepOutputFile(stepNumber: number, scriptName: string): string {
    return path.join(this.getIssueDir(), `step${stepNumber}-${scriptName}.md`);
  }

  getPrCommentsFile(): string {
    return path.join(this.getIssueDir(), "pr-comments.json");
  }

  getCiFailuresFile(): string {
    return path.join(this.getIssueDir(), "ci-failures.json");
  }

  getLogFile(): string {
    return path.join(this.getIssueDir(), "system.log");
  }

  getAgentLogFile(): string {
    return path.join(this.getIssueDir(), "agent.log");
  }

  getDiagnosticFile(): string {
    return path.join(this.getIssueDir(), "diagnostic.json");
  }

  getPrReviewAgentLogFile(): string {
    return path.join(this.getIssueDir(), "pr-review-agent.log");
  }

  getReviewDiffFile(): string {
    return path.join(this.getIssueDir(), "review-diff.json");
  }

  getWorktreeDir(): string {
    return path.join(this.getIssueDir(), "worktree");
  }

  getAgentDataExportDir(): string {
    return path.join(this.getIssueDir(), "agent-data");
  }

  getOwner(): string {
    return this.owner;
  }

  getRepo(): string {
    return this.repo;
  }

  getIssueNumber(): number {
    return this.issueNumber;
  }
}

/**
 * 便捷函数：创建 SessionPathManager 实例
 */
export function getSessionPaths(owner: string, repo: string, issueNumber: number): SessionPathManager {
  return new SessionPathManager(owner, repo, issueNumber);
}
