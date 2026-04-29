import fs from 'fs';
import type { Result } from '../core/common';
import { failure, success } from '../core/common';
import { readSession } from '../core/db';
import { SessionPathManager } from '../core/session-paths';
import { isActiveSessionStatus } from './session-state-machine';

/**
 * Task 类，用于管理任务相关的 Session 文件数据和工作区
 */
export class Task {
  public taskNumber: number;
  public owner: string;
  public repo: string;
  public status: any = null;
  public todo: any = null;
  public worktree: string | null = null;
  private paths: SessionPathManager;

  constructor(owner: string, repo: string, taskNumber: number) {
    this.taskNumber = taskNumber;
    this.owner = owner;
    this.repo = repo;
    this.paths = new SessionPathManager(owner, repo, taskNumber);

    // 尝试加载数据
    this.status = this.readStatus().success ? this.readStatus().data : null;
    this.todo = this.readToDo();
    this.worktree = this.readWorktree();
  }

  /**
   * 读取状态文件并解析为 JSON 对象
   */
  readStatus(): Result<any> {
    return readSession(this.owner, this.repo, this.taskNumber);
  }

  /**
   * 读取待办事项文件并解析为 JSON 对象
   */
  readToDo() {
    const file = this.paths.getTodoFile();
    if (!fs.existsSync(file)) return null;
    try {
      const content = fs.readFileSync(file, 'utf-8');
      return this.parseToDoMarkdown(content);
    } catch {
      return null;
    }
  }

  /**
   * 将 TODO Markdown 解析为结构化的 JSON 对象
   */
  private parseToDoMarkdown(content: string) {
    const lines = content.split('\n');
    const items = lines
      .filter((line) => line.trim().match(/^- \[[ x/]\]/))
      .map((line) => {
        const match = line.trim().match(/^- \[(.)\]\s*(.*)$/);
        if (!match) return null;
        const statusChar = match[1];
        const text = match[2];
        return {
          text,
          status:
            statusChar === 'x'
              ? 'done'
              : statusChar === '/'
                ? 'running'
                : 'todo',
          completed: statusChar === 'x',
          raw: line.trim(),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const currentItem = items.find((item) => item.status !== 'done');

    return {
      items,
      currentStep: currentItem
        ? currentItem.text
        : items.length > 0
          ? '已完成'
          : '未知',
      raw: content,
    };
  }

  /**
   * 读取工作区路径
   */
  readWorktree() {
    const worktreeDir = this.paths.getWorktreeDir();
    return fs.existsSync(worktreeDir) ? worktreeDir : null;
  }

  notExists() {
    return !this.status && !this.todo && !this.worktree;
  }

  checkHealth(): Result<null> {
    const statusRes = this.readStatus();
    if (!statusRes.success) return statusRes;
    const status = statusRes.data;

    if (!status && !this.todo && !this.worktree) return success(null);

    // 如果 session 处于活跃状态，但没有 worktree
    if (isActiveSessionStatus(status?.lifecycle) && this.worktree === null) {
      const msg = `Task#${this.taskNumber}正在运行，但没有worktree
      💡 建议做法：
      1. 运行along issue-clean ${this.taskNumber}, 清理任务后重新启动
      `;
      return failure(msg);
    }

    return success(null);
  }
}
