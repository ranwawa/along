import path from "path";
import fs from "fs";
import { iso_timestamp } from "./common";
import { SessionPathManager } from "./session-paths";

export interface StepRecord {
  step: string;
  message?: string;
  startTime: string;
  endTime?: string;
}

export interface SessionStatus {
  issueNumber: number;
  status: "running" | "completed" | "error" | "crashed" | "awaiting_approval";
  startTime: string;
  endTime?: string;
  branchName: string;
  worktreePath: string;
  title: string;
  repo: { owner: string; name: string };
  agentRole?: string;
  agentType?: string;
  agentCommand?: string;
  pid?: number;
  prUrl?: string;
  prNumber?: number;
  commitShas?: string[];
  lastUpdate?: string;
  lastMessage?: string;
  currentStep?: string;
  stepHistory?: StepRecord[];
  errorMessage?: string;
  exitCode?: number;
  crashLog?: string;
  cleanupTime?: string;
  cleanupReason?: string;
  retryCount?: number;
  ciResults?: { passed: number; failed: number; lastSha?: string };
  reviewCommentCount?: number;
  environment?: {
    agentType: string;
    gitHeadSha: string;
    alongVersion: string;
    nodeVersion: string;
    platform: string;
  };
}

export class SessionManager {
  private paths: SessionPathManager;

  constructor(owner: string, repo: string, issueNumber: number) {
    this.paths = new SessionPathManager(owner, repo, issueNumber);
  }

  private get statusFile(): string {
    return this.paths.getStatusFile();
  }

  private get logFile(): string {
    return this.paths.getLogFile();
  }

  /**
   * 读取当前会话状态
   */
  readStatus(): SessionStatus | null {
    if (!fs.existsSync(this.statusFile)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.statusFile, "utf-8"));
    } catch {
      return null;
    }
  }

  /**
   * 写入会话状态
   */
  writeStatus(status: Partial<SessionStatus>): void {
    let currentStatus = this.readStatus();

    if (!currentStatus) {
      currentStatus = {
        issueNumber: this.paths.getIssueNumber(),
        status: "running",
        startTime: iso_timestamp(),
        branchName: "",
        worktreePath: "",
        title: "",
        repo: { owner: this.paths.getOwner(), name: this.paths.getRepo() },
      } as SessionStatus;
    }

    const updatedStatus = {
      ...currentStatus,
      ...status,
      lastUpdate: iso_timestamp(),
    };

    this.paths.ensureDir();
    fs.writeFileSync(this.statusFile, JSON.stringify(updatedStatus, null, 2));
  }

  /**
   * 记录日志到文件
   */
  log(message: string, level: "info" | "warn" | "error" = "info"): void {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    this.paths.ensureDir();
    fs.appendFileSync(this.logFile, logLine);
  }

  /**
   * 标记会话为错误状态
   */
  markAsError(errorMessage: string, exitCode?: number): void {
    this.writeStatus({
      status: "error",
      endTime: iso_timestamp(),
      errorMessage,
      exitCode,
    });
    this.log(`Error: ${errorMessage}`, "error");
  }

  /**
   * 标记会话为崩溃状态（异常退出）
   */
  markAsCrashed(errorMessage: string, crashLog?: string, exitCode?: number): void {
    this.writeStatus({
      status: "crashed",
      endTime: iso_timestamp(),
      errorMessage,
      crashLog,
      exitCode,
    });
    this.log(`Crashed: ${errorMessage}`, "error");
    if (crashLog) {
      this.log(`Crash details:\n${crashLog}`, "error");
    }
  }

  /**
   * 标记会话为完成状态
   */
  markAsCompleted(): void {
    this.writeStatus({
      status: "completed",
      endTime: iso_timestamp(),
    });
    this.log("Completed successfully", "info");
  }

  /**
   * 更新当前步骤（同时记录步骤历史）
   */
  updateStep(step: string, message?: string): void {
    const current = this.readStatus();
    const now = iso_timestamp();

    // 关闭上一个步骤的 endTime
    const history = current?.stepHistory || [];
    if (history.length > 0) {
      const last = history[history.length - 1];
      if (!last.endTime) {
        last.endTime = now;
      }
    }

    // 添加新步骤
    history.push({ step, message, startTime: now });

    this.writeStatus({
      currentStep: step,
      lastMessage: message,
      stepHistory: history,
    });
    if (message) {
      this.log(`Step: ${step} - ${message}`, "info");
    } else {
      this.log(`Step: ${step}`, "info");
    }
  }

  /**
   * 记录结构化事件到 session.log（供各子脚本调用）
   */
  logEvent(event: string, details?: Record<string, any>): void {
    const detailStr = details ? " " + JSON.stringify(details) : "";
    this.log(`[EVENT] ${event}${detailStr}`, "info");
  }

  /**
   * 追加 commit SHA 到 commitShas 列表
   */
  addCommitSha(sha: string): void {
    const current = this.readStatus();
    const shas = current?.commitShas || [];
    shas.push(sha);
    this.writeStatus({ commitShas: shas });
  }

  /**
   * 递增 retryCount
   */
  incrementRetry(): void {
    const current = this.readStatus();
    const count = (current?.retryCount || 0) + 1;
    this.writeStatus({ retryCount: count });
  }

  /**
   * 更新 CI 结果
   */
  updateCiResults(passed: number, failed: number, sha?: string): void {
    this.writeStatus({
      ciResults: { passed, failed, lastSha: sha },
    });
  }

  /**
   * 标记会话为等待审批状态（两阶段工作流 Phase 1 完成后）
   */
  markAsAwaitingApproval(): void {
    this.writeStatus({
      status: "awaiting_approval",
      currentStep: "等待计划审批",
      lastMessage: "计划已发布到 Issue 评论，等待 approved 标签",
    });
    this.log("Phase 1 completed, awaiting plan approval", "info");
  }

  /** 获取内部路径管理器 */
  getPathManager(): SessionPathManager {
    return this.paths;
  }
}
