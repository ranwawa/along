import fs from "fs";
import { iso_timestamp, Result, success, failure } from "./common";
import { SessionPathManager } from "./session-paths";
import { readSession, upsertSession } from "./db";

export interface StepRecord {
  step: string;
  message?: string;
  startTime: string;
  endTime?: string;
}

export interface SessionStatus {
  issueNumber: number;
  status: "running" | "completed" | "error" | "crashed";
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
  private owner: string;
  private repo: string;
  private issueNumber: number;

  constructor(owner: string, repo: string, issueNumber: number) {
    this.owner = owner;
    this.repo = repo;
    this.issueNumber = issueNumber;
    this.paths = new SessionPathManager(owner, repo, issueNumber);
  }

  private get logFile(): string {
    return this.paths.getLogFile();
  }

  /**
   * 读取当前会话状态
   */
  readStatus(): Result<SessionStatus | null> {
    return readSession(this.owner, this.repo, this.issueNumber);
  }

  /**
   * 写入会话状态
   */
  writeStatus(status: Partial<SessionStatus>): Result<void> {
    const res = this.readStatus();
    if (!res.success) return res;
    const currentStatus = res.data;

    if (!currentStatus) {
      // 首次写入，设置默认值
      const defaults: Partial<SessionStatus> = {
        issueNumber: this.issueNumber,
        status: "running",
        startTime: iso_timestamp(),
        branchName: "",
        worktreePath: "",
        title: "",
        repo: { owner: this.owner, name: this.repo },
      };
      return upsertSession(this.owner, this.repo, this.issueNumber, {
        ...defaults,
        ...status,
        lastUpdate: iso_timestamp(),
      });
    } else {
      return upsertSession(this.owner, this.repo, this.issueNumber, {
        ...status,
        lastUpdate: iso_timestamp(),
      });
    }
  }

  /**
   * 记录日志到文件
   */
  log(message: string, level: "info" | "warn" | "error" = "info"): Result<void> {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    const ensureRes = this.paths.ensureDir();
    if (!ensureRes.success) return ensureRes;
    try {
      fs.appendFileSync(this.logFile, logLine);
      return success(undefined);
    } catch (e: any) {
      return failure(`无法写入日志文件 ${this.logFile}: ${e.message}`);
    }
  }

  /**
   * 标记会话为错误状态
   */
  markAsError(errorMessage: string, exitCode?: number): Result<void> {
    const writeRes = this.writeStatus({
      status: "error",
      endTime: iso_timestamp(),
      errorMessage,
      exitCode,
    });
    this.log(`Error: ${errorMessage}`, "error");
    return writeRes;
  }

  /**
   * 标记会话为崩溃状态（异常退出）
   */
  markAsCrashed(errorMessage: string, crashLog?: string, exitCode?: number): Result<void> {
    const writeRes = this.writeStatus({
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
    return writeRes;
  }

  /**
   * 标记会话为完成状态
   */
  markAsCompleted(): Result<void> {
    const writeRes = this.writeStatus({
      status: "completed",
      endTime: iso_timestamp(),
    });
    this.log("Completed successfully", "info");
    return writeRes;
  }

  /**
   * 更新当前步骤（同时记录步骤历史）
   */
  updateStep(step: string, message?: string): Result<void> {
    const res = this.readStatus();
    if (!res.success) return res;
    const current = res.data;
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

    const writeRes = this.writeStatus({
      currentStep: step,
      lastMessage: message,
      stepHistory: history,
    });
    if (message) {
      this.log(`Step: ${step} - ${message}`, "info");
    } else {
      this.log(`Step: ${step}`, "info");
    }
    return writeRes;
  }

  /**
   * 记录结构化事件到 session.log（供各子脚本调用）
   */
  logEvent(event: string, details?: Record<string, any>): Result<void> {
    const detailStr = details ? " " + JSON.stringify(details) : "";
    return this.log(`[EVENT] ${event}${detailStr}`, "info");
  }

  /**
   * 追加 commit SHA 到 commitShas 列表
   */
  addCommitSha(sha: string): Result<void> {
    const res = this.readStatus();
    if (!res.success) return res;
    const current = res.data;
    const shas = current?.commitShas || [];
    shas.push(sha);
    return this.writeStatus({ commitShas: shas });
  }

  /**
   * 递增 retryCount
   */
  incrementRetry(): Result<void> {
    const res = this.readStatus();
    if (!res.success) return res;
    const current = res.data;
    const count = (current?.retryCount || 0) + 1;
    return this.writeStatus({ retryCount: count });
  }

  /**
   * 更新 CI 结果
   */
  updateCiResults(passed: number, failed: number, sha?: string): Result<void> {
    return this.writeStatus({
      ciResults: { passed, failed, lastSha: sha },
    });
  }

  /** 获取内部路径管理器 */
  getPathManager(): SessionPathManager {
    return this.paths;
  }
}
