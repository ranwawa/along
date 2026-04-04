import path from "path";
import fs from "fs";
import { iso_timestamp } from "./common";
import { SessionPathManager } from "./session-paths";

export interface SessionStatus {
  issueNumber: number;
  status: "running" | "completed" | "error" | "crashed";
  startTime: string;
  endTime?: string;
  branchName: string;
  worktreePath: string;
  title: string;
  repo: { owner: string; name: string };
  lastUpdate?: string;
  lastMessage?: string;
  currentStep?: string;
  errorMessage?: string;
  exitCode?: number;
  crashLog?: string;
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
   * 更新当前步骤
   */
  updateStep(step: string, message?: string): void {
    this.writeStatus({
      currentStep: step,
      lastMessage: message,
    });
    if (message) {
      this.log(`Step: ${step} - ${message}`, "info");
    } else {
      this.log(`Step: ${step}`, "info");
    }
  }

  /** 获取内部路径管理器 */
  getPathManager(): SessionPathManager {
    return this.paths;
  }
}
