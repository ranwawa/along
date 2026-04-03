import path from "path";
import fs from "fs";
import { config } from "./config";
import { iso_timestamp, getSessionId, isNewFormatSessionId } from "./common";

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
  private issueNumber: number;
  private owner?: string;
  private repo?: string;
  private config: any;
  private statusFile: string;
  private logFile: string;
  private sessionId: string;

  constructor(issueNumber: number, config: any, owner?: string, repo?: string) {
    this.issueNumber = issueNumber;
    this.owner = owner;
    this.repo = repo;
    this.config = config;
    
    // 确定使用的 session ID
    if (owner && repo) {
      this.sessionId = getSessionId(owner, repo, issueNumber);
    } else {
      this.sessionId = String(issueNumber);
    }
    
    // 尝试查找状态文件（优先新格式，降级到旧格式）
    this.statusFile = this.findStatusFile(config, this.sessionId, issueNumber);
    this.logFile = this.findLogFile(config, this.sessionId, issueNumber);
  }

  /**
   * 查找状态文件：优先新格式，降级到旧格式
   */
  private findStatusFile(config: any, sessionId: string, issueNumber: number): string {
    const newFormat = path.join(config.SESSION_DIR, `${sessionId}-status.json`);
    if (fs.existsSync(newFormat) || (this.owner && this.repo)) {
      return newFormat;
    }
    // 降级到旧格式
    return path.join(config.SESSION_DIR, `${issueNumber}-status.json`);
  }

  /**
   * 查找日志文件：优先新格式，降级到旧格式
   */
  private findLogFile(config: any, sessionId: string, issueNumber: number): string {
    const newFormat = path.join(config.LOG_DIR, `${sessionId}.log`);
    if (fs.existsSync(newFormat) || (this.owner && this.repo)) {
      return newFormat;
    }
    // 降级到旧格式
    return path.join(config.LOG_DIR, `${issueNumber}.log`);
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
    
    // 如果session不存在，创建一个基础的
    if (!currentStatus) {
      currentStatus = {
        issueNumber: this.issueNumber,
        status: "running",
        startTime: iso_timestamp(),
        branchName: "",
        worktreePath: "",
        title: "",
        repo: { owner: "", name: "" },
      } as SessionStatus;
    }

    const updatedStatus = {
      ...currentStatus,
      ...status,
      lastUpdate: iso_timestamp(),
    };

    fs.mkdirSync(path.dirname(this.statusFile), { recursive: true });
    fs.writeFileSync(this.statusFile, JSON.stringify(updatedStatus, null, 2));
  }

  /**
   * 记录日志到文件
   */
  log(message: string, level: "info" | "warn" | "error" = "info"): void {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
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
}
