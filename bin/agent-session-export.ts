/**
 * agent-session-export.ts - 导出 Agent 会话数据
 *
 * 在 agent 完成或 worktree 清理前，将 agent 的会话/对话数据
 * 从 worktree 复制到 session 目录，防止 worktree 删除后数据丢失。
 *
 * 支持的 Agent:
 * - Claude Code: .claude/projects/ 下的会话存储
 * - OpenCode: .opencode/sessions/ 下的会话文件
 * - PI: .pi/sessions/ 下的 JSONL 会话文件
 */
import fs from "fs";
import path from "path";
import { consola } from "consola";
import type { SessionPathManager } from "./session-paths";
import type { SessionManager } from "./session-manager";

const logger = consola.withTag("agent-session-export");

interface ExportResult {
  exported: boolean;
  agentType: string;
  fileCount: number;
  totalSize: number;
  exportDir: string;
}

/** Agent 会话数据的源目录映射 */
const AGENT_SESSION_DIRS: Record<string, string[]> = {
  claude: [".claude/projects", ".claude/todos"],
  opencode: [".opencode/sessions"],
  pi: [".pi/sessions"],
};

/**
 * 递归复制目录，返回复制的文件数和总大小
 */
function copyDirRecursive(src: string, dest: string): { fileCount: number; totalSize: number } {
  let fileCount = 0;
  let totalSize = 0;

  if (!fs.existsSync(src)) return { fileCount, totalSize };

  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      const sub = copyDirRecursive(srcPath, destPath);
      fileCount += sub.fileCount;
      totalSize += sub.totalSize;
    } else {
      fs.copyFileSync(srcPath, destPath);
      const stat = fs.statSync(srcPath);
      fileCount++;
      totalSize += stat.size;
    }
  }

  return { fileCount, totalSize };
}

/**
 * 去除 ANSI 转义码
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

/**
 * 清理 agent.log：去除 ANSI 转义码，生成可读的纯文本版本
 */
function cleanAgentLog(paths: SessionPathManager): { cleaned: boolean; outputFile: string } {
  const agentLog = paths.getAgentLogFile();
  const cleanLog = path.join(path.dirname(agentLog), "agent-clean.log");

  if (!fs.existsSync(agentLog)) return { cleaned: false, outputFile: cleanLog };

  try {
    const raw = fs.readFileSync(agentLog, "utf-8");
    const clean = stripAnsi(raw);
    fs.writeFileSync(cleanLog, clean);
    return { cleaned: true, outputFile: cleanLog };
  } catch {
    return { cleaned: false, outputFile: cleanLog };
  }
}

/**
 * 检测 worktree 中使用的 agent 类型
 */
function detectAgentType(worktreePath: string): string | null {
  if (fs.existsSync(path.join(worktreePath, ".claude"))) return "claude";
  if (fs.existsSync(path.join(worktreePath, ".opencode"))) return "opencode";
  if (fs.existsSync(path.join(worktreePath, ".pi"))) return "pi";
  return null;
}

/**
 * 导出 agent 会话数据到 session 目录
 *
 * @param paths - SessionPathManager 实例
 * @param worktreePath - worktree 目录路径
 * @param session - 可选的 SessionManager，用于记录事件
 * @returns 导出结果
 */
export async function exportAgentSession(
  paths: SessionPathManager,
  worktreePath: string,
  session?: SessionManager,
): Promise<ExportResult> {
  const result: ExportResult = {
    exported: false,
    agentType: "unknown",
    fileCount: 0,
    totalSize: 0,
    exportDir: "",
  };

  if (!fs.existsSync(worktreePath)) {
    logger.warn(`worktree 不存在，跳过会话导出: ${worktreePath}`);
    return result;
  }

  const agentType = detectAgentType(worktreePath);
  if (!agentType) {
    logger.info("未检测到 agent 会话数据");
    return result;
  }

  result.agentType = agentType;
  const sessionDirs = AGENT_SESSION_DIRS[agentType] || [];
  const exportBase = path.join(paths.getAgentDataExportDir(), agentType);

  for (const relDir of sessionDirs) {
    const srcDir = path.join(worktreePath, relDir);
    if (!fs.existsSync(srcDir)) continue;

    const destDir = path.join(exportBase, relDir);
    try {
      const { fileCount, totalSize } = copyDirRecursive(srcDir, destDir);
      result.fileCount += fileCount;
      result.totalSize += totalSize;
    } catch (e: any) {
      logger.warn(`复制 ${relDir} 失败: ${e.message}`);
    }
  }

  // 清理 agent.log 生成纯文本版本
  const agentClean = cleanAgentLog(paths);

  if (result.fileCount > 0) {
    result.exported = true;
    result.exportDir = exportBase;
    logger.info(`已导出 ${agentType} 会话数据: ${result.fileCount} 个文件, ${(result.totalSize / 1024).toFixed(1)}KB`);

    session?.logEvent("agent-session-exported", {
      agentType,
      fileCount: result.fileCount,
      totalSizeBytes: result.totalSize,
      exportDir: exportBase,
      agentLogCleaned: agentClean.cleaned,
    });
  }

  return result;
}
