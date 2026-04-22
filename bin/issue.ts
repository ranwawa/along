import { get_gh_client, GitHubIssue } from "./github-client";
import { failure, success } from "./common";
import type { Result } from "./common";
import { LIFECYCLE } from "./session-state-machine";

/**
 * Issue 类，用于管理 GitHub Issue 数据和健康状态检查
 */
export class Issue {
  public taskNo: number;
  public config: any;
  public data: GitHubIssue | null = null;

  constructor(taskNo: number, config: any) {
    this.taskNo = taskNo;
    this.config = config;
  }

  /**
   * 从 GitHub 加载完整的 Issue 详情
   */
  async load(): Promise<Result<GitHubIssue>> {
    const clientRes = await get_gh_client();
    if (!clientRes.success) return clientRes;
    
    const issueRes = await clientRes.data.getIssue(this.taskNo);
    if (!issueRes.success) return issueRes;

    this.data = issueRes.data;
    return success(this.data);
  }

  /**
   * 检查 Issue 的状态是否允许执行自动化流程
   */
  checkHealth(options?: { skipWipCheck?: boolean }): Result<null> {
    if (!this.data) return failure("Issue数据尚未加载，请先调用load()");

    // 状态检查
    if (this.data.state !== "open") {
      return failure(`Issue#${this.taskNo}状态为${this.data.state}，无法处理（需为 open）`);
    }

    const labels = (this.data.labels || []).map((l: any) =>
      typeof l === "string" ? l : l.name
    );

    // 阻断标签检查
    const BLOCKED_LABELS = ["spam", "invalid"];
    if (labels.some((l: string) => BLOCKED_LABELS.includes(l.toLowerCase()))) {
      return failure(`Issue#${this.taskNo}已被标记为无效，跳过处理`);
    }

    // running 标签检查（webhook 自动化流程可跳过，因为标签是系统自己打的）
    if (!options?.skipWipCheck) {
      if (labels.some((l: string) => l === LIFECYCLE.RUNNING)) {
        return failure(`Issue#${this.taskNo}带有${LIFECYCLE.RUNNING}标签（agent正在运行），已主动阻断执行`);
      }
    }

    return success(null);
  }
}
