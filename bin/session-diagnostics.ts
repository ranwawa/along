import fs from "fs";
import type { SessionStatus } from "./session-manager";
import type { SessionPhase } from "./session-state-machine";
import { SessionPathManager } from "./session-paths";

export type SessionLogSource = "system" | "agent" | "merged";

export interface SessionLogEntry {
  source: SessionLogSource;
  raw: string;
  timestamp?: string;
  level?: string;
  message: string;
  tag?: string;
}

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

const DEFAULT_SYSTEM_LINES = 120;
const DEFAULT_AGENT_LINES = 200;

function readLastLines(filePath: string, maxLines: number): string[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content) return [];
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-maxLines);
  } catch {
    return [];
  }
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

export function parseSystemLogLines(lines: string[]): SessionLogEntry[] {
  return lines.map((line) => {
    const match = line.match(/^\[(.+?)\]\s+\[([A-Z]+)\]\s+(.*)$/);
    if (!match) {
      return {
        source: "system",
        raw: line,
        message: line,
      };
    }

    return {
      source: "system",
      raw: line,
      timestamp: match[1],
      level: match[2].toLowerCase(),
      message: match[3],
    };
  });
}

export function parseAgentLogLines(lines: string[]): SessionLogEntry[] {
  return lines.map((line) => {
    const match = line.match(/^\[(.+?)\]\s+(.*)$/);
    if (!match) {
      return {
        source: "agent",
        raw: line,
        message: line,
      };
    }

    return {
      source: "agent",
      raw: line,
      timestamp: match[1],
      message: match[2],
    };
  });
}

export function mergeSessionLogs(
  systemLogs: SessionLogEntry[],
  agentLogs: SessionLogEntry[],
): SessionLogEntry[] {
  return [...systemLogs, ...agentLogs]
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const aTime = a.entry.timestamp ? Date.parse(a.entry.timestamp) : Number.POSITIVE_INFINITY;
      const bTime = b.entry.timestamp ? Date.parse(b.entry.timestamp) : Number.POSITIVE_INFINITY;
      if (aTime !== bTime) return aTime - bTime;
      return a.index - b.index;
    })
    .map(({ entry }) => ({
      ...entry,
      source: entry.source === "system" || entry.source === "agent" ? entry.source : "merged",
    }));
}

export function readSessionLog(
  paths: SessionPathManager,
  source: SessionLogSource,
  maxLines?: number,
): SessionLogEntry[] {
  if (source === "merged") {
    const systemLogs = readSessionLog(paths, "system", maxLines || DEFAULT_SYSTEM_LINES);
    const agentLogs = readSessionLog(paths, "agent", maxLines || DEFAULT_AGENT_LINES);
    return mergeSessionLogs(systemLogs, agentLogs);
  }

  const limit = maxLines || (source === "system" ? DEFAULT_SYSTEM_LINES : DEFAULT_AGENT_LINES);
  const filePath = source === "system" ? paths.getLogFile() : paths.getAgentLogFile();
  const lines = readLastLines(filePath, limit);
  return source === "system" ? parseSystemLogLines(lines) : parseAgentLogLines(lines);
}

export function generateSessionDiagnostic(
  session: SessionStatus,
  paths: SessionPathManager,
): SessionDiagnostic {
  const lastSystemLines = readLastLines(paths.getLogFile(), 50);
  const lastAgentLines = readLastLines(paths.getAgentLogFile(), 100);
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
