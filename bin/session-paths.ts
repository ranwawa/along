import path from "path";
import fs from "fs";
import { config } from "./config";
import { getSessionId, isNewFormatSessionId, parseSessionId, Result, success, failure } from "./common";

export interface SessionPathOptions {
  owner?: string;
  repo?: string;
  issueNumber: number;
}

/**
 * 统一管理所有 session 相关的路径生成
 */
export class SessionPathManager {
  private options: SessionPathOptions;
  private sessionId: string;
  private useNewFormat: boolean;

  constructor(options: SessionPathOptions) {
    this.options = options;
    this.useNewFormat = !!(options.owner && options.repo);
    this.sessionId = this.useNewFormat 
      ? getSessionId(options.owner!, options.repo!, options.issueNumber)
      : String(options.issueNumber);
  }

  /**
   * 从 issueNumber 或 sessionId 创建实例（自动检测格式）
   */
  static fromIdentifier(identifier: string | number, config: any): SessionPathManager {
    const idStr = String(identifier);
    
    if (isNewFormatSessionId(idStr)) {
      const parseResult = parseSessionId(idStr);
      if (parseResult.success) {
        return new SessionPathManager(parseResult.data);
      }
    }
    
    // 回退到旧格式
    return new SessionPathManager({ issueNumber: Number(identifier) });
  }

  /**
   * 获取状态文件路径
   */
  getStatusFile(): string {
    return path.join(config.SESSION_DIR, `${this.sessionId}-status.json`);
  }

  /**
   * 获取 todo 文件路径
   */
  getTodoFile(): string {
    return path.join(config.SESSION_DIR, `${this.sessionId}-todo.md`);
  }

  /**
   * 获取 issue 缓存文件路径
   */
  getIssueFile(): string {
    return path.join(config.SESSION_DIR, `${this.sessionId}-issue.json`);
  }

  /**
   * 获取步骤产出文件路径
   */
  getStepOutputFile(stepNumber: number, scriptName: string): string {
    return path.join(config.SESSION_DIR, `${this.sessionId}-step${stepNumber}-${scriptName}.md`);
  }

  /**
   * 获取 PR 评论文件路径
   */
  getPrCommentsFile(): string {
    return path.join(config.SESSION_DIR, `${this.sessionId}-pr-comments.json`);
  }

  /**
   * 获取主日志文件路径
   */
  getLogFile(): string {
    return path.join(config.LOG_DIR, `${this.sessionId}.log`);
  }

  /**
   * 获取 tmux 日志文件路径
   */
  getTmuxLogFile(): string {
    return path.join(config.LOG_DIR, `${this.sessionId}-tmux.log`);
  }

  /**
   * 获取 PR review tmux 日志文件路径
   */
  getPrReviewTmuxLogFile(): string {
    return path.join(config.LOG_DIR, `${this.sessionId}-pr-review-tmux.log`);
  }

  /**
   * 获取工作区目录路径
   */
  getWorktreeDir(): string {
    return path.join(config.WORKTREE_DIR, this.sessionId);
  }

  /**
   * 查找现有文件（支持向后兼容：先尝试新格式，再尝试旧格式）
   */
  findExistingFile(getNewPath: () => string, getOldPath: () => string): string | null {
    const newPath = getNewPath();
    if (fs.existsSync(newPath)) {
      return newPath;
    }
    
    const oldPath = getOldPath();
    if (fs.existsSync(oldPath)) {
      return oldPath;
    }
    
    return null;
  }

  /**
   * 获取 sessionId
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * 检查是否使用新格式
   */
  isNewFormat(): boolean {
    return this.useNewFormat;
  }

  /**
   * 获取选项
   */
  getOptions(): SessionPathOptions {
    return { ...this.options };
  }
}

/**
 * 便捷函数：创建 SessionPathManager 实例
 */
export function getSessionPaths(issueNumber: number, owner?: string, repo?: string): SessionPathManager {
  return new SessionPathManager({ issueNumber, owner, repo });
}

/**
 * 便捷函数：从状态文件中读取 repo 信息并创建 SessionPathManager
 */
export function getSessionPathsFromStatus(issueNumber: number, config: any): Result<SessionPathManager> {
  // 先尝试旧格式
  let statusFile = path.join(config.SESSION_DIR, `${issueNumber}-status.json`);
  if (!fs.existsSync(statusFile)) {
    return failure(`状态文件不存在: ${statusFile}`);
  }
  
  try {
    const status = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
    if (status.repo && status.repo.owner && status.repo.name) {
      return success(new SessionPathManager({
        owner: status.repo.owner,
        repo: status.repo.name,
        issueNumber
      }));
    }
    // 没有 repo 信息，使用旧格式
    return success(new SessionPathManager({ issueNumber }));
  } catch (e) {
    return failure(`解析状态文件失败: ${statusFile}`);
  }
}

/**
 * 扫描 sessions 目录，找到所有状态文件
 */
export function findAllStatusFiles(config: any): Array<{ path: string; sessionId: string; isNewFormat: boolean }> {
  if (!fs.existsSync(config.SESSION_DIR)) return [];
  
  const files = fs.readdirSync(config.SESSION_DIR).filter(f => f.endsWith("-status.json"));
  return files.map(file => {
    const sessionId = file.replace("-status.json", "");
    return {
      path: path.join(config.SESSION_DIR, file),
      sessionId,
      isNewFormat: isNewFormatSessionId(sessionId)
    };
  });
}
