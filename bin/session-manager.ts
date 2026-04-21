import fs from "fs";
import { iso_timestamp, success, failure } from "./common";
import type { Result } from "./common";
import { SessionPathManager } from "./session-paths";
import { readSession, upsertSession, transactSession } from "./db";
import {
  applySessionStateEvent,
  getWorkflowStartPoint,
  type AgentWorkflow,
  type SessionContext,
  type SessionError,
  type SessionLifecycle,
  type SessionPhase,
  type SessionProgress,
  type SessionStateEvent,
  type SessionStep,
} from "./session-state-machine";

export interface SessionStatus {
  issueNumber: number;
  lifecycle: SessionLifecycle;
  phase: SessionPhase;
  step: SessionStep;
  startTime: string;
  endTime?: string;
  phaseStartedAt?: string;
  stepStartedAt?: string;
  worktreePath: string;
  title: string;
  repo: { owner: string; name: string };
  agentRole?: string;
  agentType?: string;
  agentCommand?: string;
  pid?: number;
  lastUpdate?: string;
  message?: string;
  progress?: SessionProgress;
  context?: SessionContext;
  error?: SessionError;
  retryCount?: number;
  ciResults?: { passed: number; failed: number; lastSha?: string };
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

  readStatus(): Result<SessionStatus | null> {
    return readSession(this.owner, this.repo, this.issueNumber);
  }

  writeStatus(status: Partial<SessionStatus>): Result<void> {
    const res = this.readStatus();
    if (!res.success) return res;
    const currentStatus = res.data;

    if (!currentStatus) {
      const start = getWorkflowStartPoint("phase1");
      const defaults: Partial<SessionStatus> = {
        issueNumber: this.issueNumber,
        lifecycle: "running",
        phase: start.phase,
        step: start.step,
        startTime: iso_timestamp(),
        worktreePath: "",
        title: "",
        repo: { owner: this.owner, name: this.repo },
        context: { issueNumber: this.issueNumber, repo: `${this.owner}/${this.repo}` },
      };
      return upsertSession(this.owner, this.repo, this.issueNumber, {
        ...defaults,
        ...status,
        lastUpdate: iso_timestamp(),
      });
    }

    return upsertSession(this.owner, this.repo, this.issueNumber, {
      ...status,
      lastUpdate: iso_timestamp(),
    });
  }

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

  transition(event: SessionStateEvent): Result<void> {
    return transactSession(this.owner, this.repo, this.issueNumber, (current) => {
      const { patch } = applySessionStateEvent(current, event);
      return {
        ...patch,
        lastUpdate: iso_timestamp(),
      };
    });
  }

  markAsError(errorMessage: string, exitCode?: number): Result<void> {
    const writeRes = this.transition({ type: "BLOCKED", message: errorMessage, exitCode });
    this.log(`Error: ${errorMessage}`, "error");
    return writeRes;
  }

  markAsCrashed(errorMessage: string, crashLog?: string, exitCode?: number): Result<void> {
    const writeRes = this.transition({
      type: "AGENT_EXITED_FAILURE",
      message: errorMessage,
      crashLog,
      exitCode,
    });
    this.log(`Crashed: ${errorMessage}`, "error");
    if (crashLog) {
      this.log(`Crash details:\n${crashLog}`, "error");
    }
    return writeRes;
  }

  updateStep(step: SessionStep, message?: string, phase?: SessionPhase): Result<void> {
    const currentRes = this.readStatus();
    if (!currentRes.success) return currentRes;
    const currentPhase = phase || currentRes.data?.phase || "planning";
    const writeRes = this.transition({
      type: "STEP_CHANGED",
      phase: currentPhase,
      step,
      message,
    });
    this.log(`Step: ${step}${message ? ` - ${message}` : ""}`, "info");
    return writeRes;
  }

  startWorkflow(workflow: AgentWorkflow, message?: string): Result<void> {
    return this.transition({ type: "START_PHASE", workflow, message });
  }

  logEvent(event: string, details?: Record<string, any>): Result<void> {
    const detailStr = details ? " " + JSON.stringify(details) : "";
    return this.log(`[EVENT] ${event}${detailStr}`, "info");
  }

  addCommitSha(sha: string): Result<void> {
    return transactSession(this.owner, this.repo, this.issueNumber, (current) => {
      const context = { ...(current?.context || { issueNumber: this.issueNumber }) };
      const shas = context.commitShas ? [...context.commitShas] : [];
      shas.push(sha);
      context.commitShas = shas;
      return { context, lastUpdate: iso_timestamp() };
    });
  }

  incrementRetry(): Result<void> {
    return transactSession(this.owner, this.repo, this.issueNumber, (current) => {
      const count = (current?.retryCount || 0) + 1;
      return { retryCount: count, lastUpdate: iso_timestamp() };
    });
  }

  updateCiResults(passed: number, failed: number, sha?: string): Result<void> {
    return this.writeStatus({
      ciResults: { passed, failed, lastSha: sha },
    });
  }

  getPathManager(): SessionPathManager {
    return this.paths;
  }
}
