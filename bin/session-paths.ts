import path from "path";
import fs from "fs";
import { config } from "./config";

/**
 * 统一管理所有 session 相关的路径生成
 * 目录结构: ~/.along/{owner}/{repo}/{issueNumber}/
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
  ensureDir(): void {
    fs.mkdirSync(this.getIssueDir(), { recursive: true });
  }

  getStatusFile(): string {
    return path.join(this.getIssueDir(), "status.json");
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
    return path.join(this.getIssueDir(), "session.log");
  }

  getTmuxLogFile(): string {
    return path.join(this.getIssueDir(), "tmux.log");
  }

  getPrReviewTmuxLogFile(): string {
    return path.join(this.getIssueDir(), "pr-review-tmux.log");
  }

  getReviewDiffFile(): string {
    return path.join(this.getIssueDir(), "review-diff.json");
  }

  getReviewWatchTmuxLogFile(): string {
    return path.join(this.getIssueDir(), "review-watch-tmux.log");
  }

  getWorktreeDir(): string {
    return path.join(this.getIssueDir(), "worktree");
  }

  getAgentSessionExport(): string {
    return path.join(this.getIssueDir(), "agent-session.jsonl");
  }

  getEventLogFile(): string {
    return path.join(this.getIssueDir(), "events.jsonl");
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

export interface SessionInfo {
  owner: string;
  repo: string;
  issueNumber: number;
  statusFile: string;
}

/**
 * 扫描所有 session（三级目录遍历）
 * 可选按 owner/repo 过滤
 */
export function findAllSessions(filterOwner?: string, filterRepo?: string): SessionInfo[] {
  const baseDir = config.USER_ALONG_DIR;
  if (!fs.existsSync(baseDir)) return [];

  const results: SessionInfo[] = [];

  const ownerDirs = filterOwner
    ? [filterOwner]
    : fs.readdirSync(baseDir).filter(d => {
        const full = path.join(baseDir, d);
        return fs.statSync(full).isDirectory() && !d.startsWith(".");
      });

  for (const owner of ownerDirs) {
    const ownerPath = path.join(baseDir, owner);
    if (!fs.existsSync(ownerPath) || !fs.statSync(ownerPath).isDirectory()) continue;

    const repoDirs = filterRepo
      ? [filterRepo]
      : fs.readdirSync(ownerPath).filter(d => {
          const full = path.join(ownerPath, d);
          return fs.statSync(full).isDirectory();
        });

    for (const repo of repoDirs) {
      const repoPath = path.join(ownerPath, repo);
      if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) continue;

      const issueDirs = fs.readdirSync(repoPath).filter(d => {
        const full = path.join(repoPath, d);
        return fs.statSync(full).isDirectory() && /^\d+$/.test(d);
      });

      for (const issueDir of issueDirs) {
        const statusFile = path.join(repoPath, issueDir, "status.json");
        if (fs.existsSync(statusFile)) {
          results.push({
            owner,
            repo,
            issueNumber: Number(issueDir),
            statusFile,
          });
        }
      }
    }
  }

  return results;
}
