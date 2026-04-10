import { get_gh_client, GitHubIssue } from "./github-client";
import { failure, success, Result } from "./common";

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
    if (!clientRes.success) return failure(clientRes.error);
    
    try {
      this.data = await clientRes.data.getIssue(this.taskNo);
      return success(this.data);
    } catch (e: any) {
      return failure(`无法从 GitHub 获取编号为 #${this.taskNo} 的内容: ${e.message}`);
    }
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

    // 标签检查（webhook 自动化流程可跳过 WIP 检查，因为 WIP 是系统自己打的）
    if (!options?.skipWipCheck) {
      const labels = (this.data.labels || []).map((l: any) =>
        typeof l === "string" ? l : l.name
      );

      if (labels.some((l: string) => l.toUpperCase() === "WIP")) {
        return failure(`Issue#${this.taskNo}带有WIP标签，已主动阻断执行`);
      }
    }

    return success(null);
  }
}
