import fs from "fs";
import type { SessionStatus } from "./session-manager";
import type { SessionPhase } from "./session-state-machine";
import { SessionPathManager } from "../core/session-paths";
import type { UnifiedLogEntry } from "../logging/log-types";

export interface SessionDiagnostic {
  category: string;
  summary: string;
  failedAt?: string;
  phase?: SessionPhase;
  exitCode?: number;
  command?: string;
  errorMessage?: string;
  hints: string[];
  lastSystemLines: string[];
  lastAgentLines: string[];
}

function classifyFailure(text: string): {
  category: string;
  summary: string;
  hints: string[];
} {
  const normalized = text.toLowerCase();

  if (normalized.includes("403") && normalized.includes("insufficient balance")) {
    return {
      category: "auth/billing",
      summary: "Agent 认证失败：账户余额不足或配额不可用",
      hints: [
        "检查当前 Agent 供应商账户余额或套餐配额",
        "确认 along 使用的 API Key 对应的是预期账号",
        "补充余额后重新启动该任务，确认错误是否消失",
      ],
    };
  }

  if (normalized.includes("failed to authenticate") || normalized.includes("unauthorized") || normalized.includes("authentication")) {
    return {
      category: "auth",
      summary: "Agent 认证失败，凭证无效或权限不足",
      hints: [
        "检查对应 Agent 的 API Key 是否存在且未过期",
        "确认环境变量已注入到执行环境",
        "核对账号权限、模型权限或组织级限制",
      ],
    };
  }

  if (normalized.includes("insufficient_quota") || normalized.includes("quota")) {
    return {
      category: "quota",
      summary: "Agent 请求被配额限制阻断",
      hints: [
        "检查供应商侧配额或频率限制",
        "确认是否切换到了受限模型或组织",
        "稍后重试，并观察是否为瞬时限流",
      ],
    };
  }

  if (normalized.includes("eacces") || normalized.includes("permission denied")) {
    return {
      category: "permissions",
      summary: "任务执行失败：文件或环境权限不足",
      hints: [
        "检查 worktree、日志目录和凭证文件的访问权限",
        "确认子进程是否有相同的环境变量与目录权限",
        "必要时在终端复现同一命令以确认权限边界",
      ],
    };
  }

  if (normalized.includes("timed out") || normalized.includes("timeout") || normalized.includes("etimedout")) {
    return {
      category: "network/timeout",
      summary: "任务执行超时或网络请求未完成",
      hints: [
        "检查本机网络连通性和代理配置",
        "确认目标 API 服务是否可用",
        "结合 agent 原始日志确认是启动阶段还是执行阶段超时",
      ],
    };
  }

  return {
    category: "agent/process",
    summary: "Agent 进程异常退出，需要结合原始日志继续排查",
    hints: [
      "先查看 Agent Log 最后的错误输出",
      "再对照 System Log 确认失败前最后一个系统步骤",
      "如果问题可复现，优先在相同 worktree 中手动执行命令复现",
    ],
  };
}

function readLastJsonlEntries(filePath: string, maxEntries: number): UnifiedLogEntry[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content) return [];
    const lines = content.trim().split("\n").filter(Boolean).slice(-maxEntries);
    const entries: UnifiedLogEntry[] = [];
    for (const line of lines) {
      try { entries.push(JSON.parse(line)); } catch {}
    }
    return entries;
  } catch {
    return [];
  }
}

export function generateSessionDiagnostic(
  session: SessionStatus,
  paths: SessionPathManager,
): SessionDiagnostic {
  const sessionLogPath = paths.getSessionLogFile();
  const recentEntries = readLastJsonlEntries(sessionLogPath, 150);

  const lastLifecycleEntries = recentEntries
    .filter(e => e.category === "lifecycle")
    .slice(-50);
  const lastConversationEntries = recentEntries
    .filter(e => e.category === "conversation")
    .slice(-100);

  const lastSystemLines = lastLifecycleEntries.map(e => e.message);
  const lastAgentLines = lastConversationEntries.map(e => e.message);

  const basis = [
    session.error?.message || "",
    session.error?.details || "",
    ...lastAgentLines.slice(-20),
    ...lastSystemLines.slice(-20),
  ].join("\n");
  const classified = classifyFailure(basis);

  return {
    category: classified.category,
    summary: classified.summary,
    failedAt: session.endTime || session.lastUpdate,
    phase: session.phase,
    exitCode: session.error?.code?.startsWith("EXIT_") ? Number(session.error.code.replace("EXIT_", "")) : undefined,
    command: session.agentCommand,
    errorMessage: session.error?.message,
    hints: classified.hints,
    lastSystemLines,
    lastAgentLines,
  };
}

export function writeSessionDiagnostic(paths: SessionPathManager, diagnostic: SessionDiagnostic): void {
  const ensureRes = paths.ensureDir();
  if (!ensureRes.success) return;

  try {
    fs.writeFileSync(paths.getDiagnosticFile(), JSON.stringify(diagnostic, null, 2));
  } catch {
  }
}

export function clearSessionDiagnostic(paths: SessionPathManager): void {
  try {
    if (fs.existsSync(paths.getDiagnosticFile())) {
      fs.unlinkSync(paths.getDiagnosticFile());
    }
  } catch {
  }
}

export function readSessionDiagnostic(paths: SessionPathManager): SessionDiagnostic | null {
  const filePath = paths.getDiagnosticFile();
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as SessionDiagnostic;
  } catch {
    return null;
  }
}
