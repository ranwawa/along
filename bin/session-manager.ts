import fs from "fs";
import { iso_timestamp, success, failure } from "./common";
import type { Result } from "./common";
import { SessionPathManager } from "./session-paths";
import { readSession, upsertSession, transactSession } from "./db";
import { syncLifecycleLabel } from "./github-client";
import {
  applySessionStateEvent,
  PHASE,
  STEP,
  EVENT,
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
      const defaults: Partial<SessionStatus> = {
        issueNumber: this.issueNumber,
        lifecycle: "running",
        phase: "planning",
        step: "read_issue",
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

  async transition(event: SessionStateEvent): Promise<Result<void>> {
    const oldRes = this.readStatus();
    const oldLifecycle = oldRes.success ? oldRes.data?.lifecycle : undefined;

    const dbRes = transactSession(this.owner, this.repo, this.issueNumber, (current) => {
      const { patch } = applySessionStateEvent(current, event);
      return {
        ...patch,
        lastUpdate: iso_timestamp(),
      };
    });
    if (!dbRes.success) return dbRes;

    const newRes = this.readStatus();
    const newLifecycle = newRes.success ? newRes.data?.lifecycle : undefined;
    if (newLifecycle && newLifecycle !== oldLifecycle) {
      try {
        await syncLifecycleLabel(this.owner, this.repo, this.issueNumber, newLifecycle);
      } catch {}
    }

    return dbRes;
  }

  async markAsError(errorMessage: string, exitCode?: number): Promise<Result<void>> {
    const writeRes = await this.transition({ type: "BLOCKED", message: errorMessage, exitCode });
    this.log(`Error: ${errorMessage}`, "error");
    return writeRes;
  }

  async markAsCrashed(errorMessage: string, crashLog?: string, exitCode?: number): Promise<Result<void>> {
    const writeRes = await this.transition({
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

  async updateStep(step: SessionStep, message?: string, phase?: SessionPhase, context?: Partial<SessionContext>, pid?: number): Promise<Result<void>> {
    const currentRes = this.readStatus();
    if (!currentRes.success) return currentRes;
    const currentPhase = phase || currentRes.data?.phase || PHASE.PLANNING;
    const writeRes = await this.transition({
      type: EVENT.STEP_CHANGED,
      phase: currentPhase,
      step,
      message,
      context,
      pid,
    });
    this.log(`Step: ${step}${message ? ` - ${message}` : ""}`, "info");
    return writeRes;
  }

  async startWorkflow(phase: SessionPhase, step: SessionStep, message?: string): Promise<Result<void>> {
    return await this.transition({ type: "START_PHASE", phase, step, message });
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

  async updateCiResults(passed: number, failed: number, sha?: string): Promise<Result<void>> {
    const currentRes = this.readStatus();
    if (!currentRes.success) return currentRes;
    return await this.transition({
      type: EVENT.STEP_CHANGED,
      phase: currentRes.data?.phase || PHASE.STABILIZATION,
      step: currentRes.data?.step || STEP.FIX_CI,
      context: {
        ciResults: JSON.stringify({ passed, failed, lastSha: sha }),
      } as Partial<SessionContext>,
    });
  }

  getPathManager(): SessionPathManager {
    return this.paths;
  }
}
