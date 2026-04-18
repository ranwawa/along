import { $ } from "bun";
import { Octokit, RestEndpointMethodTypes } from "@octokit/rest";
import { success, failure, git } from "./common";
import type { Result } from "./common";
import { resolveAgentToken } from "./agent-config";
import { consola } from "consola";

const apiLogger = consola.withTag("github-api");

export type GitHubIssue = RestEndpointMethodTypes["issues"]["get"]["response"]["data"];
export type GitHubPullRequest = RestEndpointMethodTypes["pulls"]["get"]["response"]["data"];
export type GitHubReviewComment = RestEndpointMethodTypes["pulls"]["listReviewComments"]["response"]["data"][number];
export type GitHubCheckRun = RestEndpointMethodTypes["checks"]["listForRef"]["response"]["data"]["check_runs"][number];

/**
 * GitHub API 客户端 (基于官方 Octokit 实现)
 * 内置请求日志：记录每次 API 调用的方法、耗时、状态码和 rate limit
 */
export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  /** API 调用统计 */
  private stats = { total: 0, success: 0, failed: 0, totalMs: 0 };

  constructor(token: string, owner: string, repo: string) {
    this.octokit = new Octokit({ auth: token });
    this.owner = owner;
    this.repo = repo;

    // 注册请求钩子，记录每次 API 调用
    this.octokit.hook.wrap("request", async (request, options) => {
      const method = options.method || "GET";
      const url = options.url || "";
      const start = Date.now();
      this.stats.total++;

      try {
        const response = await request(options);
        const duration = Date.now() - start;
        this.stats.success++;
        this.stats.totalMs += duration;

        const rateRemaining = response.headers["x-ratelimit-remaining"];
        const rateLimit = response.headers["x-ratelimit-limit"];
        apiLogger.debug(
          `${method} ${url} → ${response.status} (${duration}ms)` +
          (rateRemaining ? ` [rate: ${rateRemaining}/${rateLimit}]` : "")
        );

        // rate limit 低于 100 时发出警告
        if (rateRemaining && Number(rateRemaining) < 100) {
          apiLogger.warn(`GitHub API rate limit 即将耗尽: ${rateRemaining}/${rateLimit}`);
        }

        return response;
      } catch (error: any) {
        const duration = Date.now() - start;
        this.stats.failed++;
        this.stats.totalMs += duration;

        // 404/410 是预期的"资源不存在"响应，降级为 debug
        const logLevel = (error.status === 404 || error.status === 410) ? "debug" : "warn";
        apiLogger[logLevel](
          `${method} ${url} → ${error.status || "ERR"} (${duration}ms): ${error.message}`
        );
        throw error;
      }
    });
  }

  /** 获取 API 调用统计 */
  getStats() {
    return { ...this.stats, avgMs: this.stats.total > 0 ? Math.round(this.stats.totalMs / this.stats.total) : 0 };
  }

  private get repoParams() {
    return {
      owner: this.owner,
      repo: this.repo,
    };
  }

  async getIssue(number: string | number): Promise<Result<GitHubIssue>> {
    try {
      const { data } = await this.octokit.issues.get({
        ...this.repoParams,
        issue_number: Number(number),
      });
      return success(data);
    } catch (e: any) {
      if (e.status === 404 || e.status === 410) {
        return failure(`获取 Issue #${number} 失败: Not Found`);
      }
      return failure(`获取 Issue #${number} 失败: ${e.message}`);
    }
  }



  async getIssueComments(number: string | number): Promise<Result<RestEndpointMethodTypes["issues"]["listComments"]["response"]["data"]>> {
    try {
      const data = await this.octokit.paginate(this.octokit.issues.listComments, {
        ...this.repoParams,
        issue_number: Number(number),
        per_page: 100,
      });
      return success(data);
    } catch (e: any) {
      return failure(`获取 Issue #${number} 评论失败: ${e.message}`);
    }
  }

  async addIssueComment(number: string | number, body: string): Promise<Result<void>> {
    try {
      await this.octokit.issues.createComment({
        ...this.repoParams,
        issue_number: Number(number),
        body,
      });
      return success(undefined);
    } catch (e: any) {
      return failure(`添加 Issue #${number} 评论失败: ${e.message}`);
    }
  }

  async addIssueLabels(number: string | number, labels: string[]): Promise<Result<void>> {
    try {
      await this.octokit.issues.addLabels({
        ...this.repoParams,
        issue_number: Number(number),
        labels,
      });
      return success(undefined);
    } catch (e: any) {
      return failure(`添加 Issue #${number} 标签失败: ${e.message}`);
    }
  }

  async removeIssueLabel(number: string | number, label: string): Promise<Result<void>> {
    try {
      await this.octokit.issues.removeLabel({
        ...this.repoParams,
        issue_number: Number(number),
        name: label,
      });
      return success(undefined);
    } catch (e: any) {
      // 标签不存在时忽略 404
      if (e.status === 404) return success(undefined);
      return failure(`移除 Issue #${number} 标签 ${label} 失败: ${e.message}`);
    }
  }

  async closeIssue(number: string | number): Promise<Result<void>> {
    try {
      await this.octokit.issues.update({
        ...this.repoParams,
        issue_number: Number(number),
        state: "closed",
      });
      return success(undefined);
    } catch (e: any) {
      return failure(`关闭 Issue #${number} 失败: ${e.message}`);
    }
  }

  async getRepositoryDetails(): Promise<Result<RestEndpointMethodTypes["repos"]["get"]["response"]["data"]>> {
    try {
      const { data } = await this.octokit.repos.get({
        ...this.repoParams,
      });
      return success(data);
    } catch (e: any) {
      return failure(`获取仓库详情失败: ${e.message}`);
    }
  }

  async getPullRequest(prNumber: number): Promise<Result<GitHubPullRequest>> {
    try {
      const { data } = await this.octokit.pulls.get({
        ...this.repoParams,
        pull_number: prNumber,
      });
      return success(data);
    } catch (e: any) {
      return failure(`获取 PR #${prNumber} 失败: ${e.message}`);
    }
  }

  async getReviewComments(prNumber: number): Promise<Result<GitHubReviewComment[]>> {
    try {
      const data = await this.octokit.paginate(this.octokit.pulls.listReviewComments, {
        ...this.repoParams,
        pull_number: prNumber,
        per_page: 100,
      });
      return success(data);
    } catch (e: any) {
      return failure(`获取 PR #${prNumber} 评审评论失败: ${e.message}`);
    }
  }

  async createReviewCommentReply(prNumber: number, commentId: number, body: string): Promise<Result<void>> {
    try {
      await this.octokit.pulls.createReplyForReviewComment({
        ...this.repoParams,
        pull_number: prNumber,
        comment_id: commentId,
        body,
      });
      return success(undefined);
    } catch (e: any) {
      return failure(`回复 PR #${prNumber} 评审评论失败: ${e.message}`);
    }
  }

  async getCheckRuns(ref: string): Promise<Result<GitHubCheckRun[]>> {
    try {
      const { data } = await this.octokit.checks.listForRef({
        ...this.repoParams,
        ref,
        per_page: 100,
      });
      return success(data.check_runs);
    } catch (e: any) {
      return failure(`获取 Ref ${ref} 的 CheckRuns 失败: ${e.message}`);
    }
  }

  /**
   * 提交 PR Review（APPROVE / REQUEST_CHANGES / COMMENT）
   * 支持 inline comments（针对具体文件和行号的评论）
   */
  async createReview(
    prNumber: number,
    body: string,
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
    comments?: Array<{ path: string; line: number; body: string; side?: "LEFT" | "RIGHT" }>,
  ): Promise<Result<void>> {
    try {
      await this.octokit.pulls.createReview({
        ...this.repoParams,
        pull_number: prNumber,
        body,
        event,
        comments: comments?.map(c => ({
          path: c.path,
          line: c.line,
          body: c.body,
          side: c.side || "RIGHT",
        })),
      });
      return success(undefined);
    } catch (e: any) {
      return failure(`提交 PR #${prNumber} 评审失败: ${e.message}`);
    }
  }

  /**
   * 列出 PR 上的所有 Reviews
   */
  async listReviews(prNumber: number): Promise<Result<RestEndpointMethodTypes["pulls"]["listReviews"]["response"]["data"]>> {
    try {
      const data = await this.octokit.paginate(this.octokit.pulls.listReviews, {
        ...this.repoParams,
        pull_number: prNumber,
        per_page: 100,
      });
      return success(data);
    } catch (e: any) {
      return failure(`获取 PR #${prNumber} 评审列表失败: ${e.message}`);
    }
  }

  /**
   * 获取 PR 变更文件列表（含 patch/diff）
   */
  async getPullRequestFiles(prNumber: number): Promise<Result<RestEndpointMethodTypes["pulls"]["listFiles"]["response"]["data"]>> {
    try {
      const data = await this.octokit.paginate(this.octokit.pulls.listFiles, {
        ...this.repoParams,
        pull_number: prNumber,
        per_page: 100,
      });
      return success(data);
    } catch (e: any) {
      return failure(`获取 PR #${prNumber} 文件列表失败: ${e.message}`);
    }
  }

  /**
   * 获取 PR 的完整 diff 文本
   */
  async getPullRequestDiff(prNumber: number): Promise<Result<string>> {
    try {
      const { data } = await this.octokit.pulls.get({
        ...this.repoParams,
        pull_number: prNumber,
        mediaType: { format: "diff" },
      });
      return success(data as unknown as string);
    } catch (e: any) {
      return failure(`获取 PR #${prNumber} Diff 失败: ${e.message}`);
    }
  }

  /**
   * 按 head 分支名列出关联的 Pull Request
   * head 格式为 "owner:branch" 或 "branch"（同仓库时自动补全 owner）
   */
  async listPullRequestsByHead(head: string): Promise<Result<RestEndpointMethodTypes["pulls"]["list"]["response"]["data"]>> {
    try {
      // 如果 head 不含 ":"，自动补全为 "owner:branch"
      const fullHead = head.includes(":") ? head : `${this.owner}:${head}`;
      const { data } = await this.octokit.pulls.list({
        ...this.repoParams,
        head: fullHead,
        state: "all",
        per_page: 100,
      });
      return success(data);
    } catch (e: any) {
      return failure(`按分支 ${head} 查找 PR 失败: ${e.message}`);
    }
  }

  /**
   * 列出仓库 Issue（支持按标签、状态、时间过滤）
   * 注意：GitHub API 会将 PR 混入 issues 列表，此方法自动过滤
   */
  async listIssues(options: {
    labels?: string;
    state?: "open" | "closed" | "all";
    since?: string;
    per_page?: number;
  } = {}): Promise<Result<GitHubIssue[]>> {
    try {
      const { data } = await this.octokit.issues.listForRepo({
        ...this.repoParams,
        state: options.state || "open",
        labels: options.labels,
        since: options.since,
        per_page: options.per_page || 100,
      });
      // GitHub API 会将 PR 混入 issues 列表，过滤掉
      const filtered = data.filter((issue: any) => !issue.pull_request) as GitHubIssue[];
      return success(filtered);
    } catch (e: any) {
      return failure(`列出 Issue 失败: ${e.message}`);
    }
  }

}

/**
 * 检查是否为 404 / Not Found 错误
 */
export function isNotFoundError(e: any): boolean {
  if (!e) return false;

  // Octokit 典型的 status 属性（404 Not Found / 410 Gone）
  if (e.status === 404 || e.status === 410) return true;

  // 备选方案：检查消息内容
  const message = e.message?.toLowerCase() || "";
  return message.includes("404") || message.includes("not found") || message.includes("410") || message.includes("gone");
}

// 默认 token 缓存
let cachedDefaultToken: string | null = null;
let cachedRepoInfo: { owner: string; repo: string } | null = null;
// 按 owner/repo 键缓存客户端，避免长运行 webhook server 中多仓库串台
const clientCache = new Map<string, GitHubClient>();

/**
 * 获取 GitHub 认证 Token
 *
 * 优先级:
 *   1. Agent 角色 token（ALONG_AGENT_ROLE 或 config.json defaultAgent → 对应角色的 githubToken）
 *   2. GH_TOKEN 环境变量（由 run.ts 在 tmux 启动时注入）
 *   3. ALONG_GITHUB_TOKEN 环境变量
 *   4. GITHUB_TOKEN 环境变量
 *   5. gh auth token
 */
export async function readGithubToken(): Promise<Result<string>> {
  // 1. Agent 角色 token
  const agentToken = resolveAgentToken();
  if (agentToken) return success(agentToken);

  // 以下为默认 token，可缓存
  if (cachedDefaultToken) return success(cachedDefaultToken);

  // 2. GH_TOKEN（由 run.ts 在 tmux 启动时注入）
  if (process.env.GH_TOKEN) {
    cachedDefaultToken = process.env.GH_TOKEN;
    return success(cachedDefaultToken);
  }

  // 3. 通用 bot token 环境变量
  if (process.env.ALONG_GITHUB_TOKEN) {
    cachedDefaultToken = process.env.ALONG_GITHUB_TOKEN;
    return success(cachedDefaultToken);
  }

  // 4. 标准 GitHub token 环境变量
  if (process.env.GITHUB_TOKEN) {
    cachedDefaultToken = process.env.GITHUB_TOKEN;
    return success(cachedDefaultToken);
  }

  // 5. gh CLI 认证
  try {
    const token = await $`gh auth token`.text();
    cachedDefaultToken = token.trim();
    return success(cachedDefaultToken);
  } catch {
    return failure("未找到 GITHUB_TOKEN 且 gh auth token 失败，请先运行 gh auth login");
  }
}

/**
 * 获取仓库所有者和名称
 */
export async function readRepoInfo(): Promise<Result<{ owner: string; repo: string }>> {
  if (cachedRepoInfo) return success(cachedRepoInfo as { owner: string; repo: string });

  try {
    const remoteStr = await git.remote(["get-url", "origin"]);
    const remote = typeof remoteStr === "string" ? remoteStr.trim() : "";

    if (!remote) return failure("无法获取 git 远程仓库 origin 信息");

    const match = remote.match(/github\.com[:\/](.+)\/(.+?)(\.git)?$/);

    if (!match) return failure(`无法解析远程仓库地址: ${remote}`);

    cachedRepoInfo = { owner: match[1], repo: match[2].trim() };
    return success(cachedRepoInfo);
  } catch (e: any) {
    return failure(`无法获取 git 远程仓库 origin 信息: ${e.message}`);
  }
}

/**
 * 获取 GitHub 客户端实例
 *
 * 支持两种模式：
 * 1. 传入 owner/repo（webhook server 场景）：按 owner/repo 缓存，避免多仓库串台
 * 2. 不传参数（CLI 场景）：从 git remote 自动检测
 */
export async function get_gh_client(owner?: string, repo?: string): Promise<Result<GitHubClient>> {
  const tokenRes = await readGithubToken();
  if (!tokenRes.success) return failure(tokenRes.error);

  if (!owner || !repo) {
    const repoRes = await readRepoInfo();
    if (!repoRes.success) return failure(repoRes.error);
    owner = repoRes.data.owner;
    repo = repoRes.data.repo;
  }

  const cacheKey = `${owner}/${repo}`;
  const cached = clientCache.get(cacheKey);
  if (cached) return success(cached);

  const client = new GitHubClient(tokenRes.data, owner, repo);
  clientCache.set(cacheKey, client);
  return success(client);
}

/**
 * 检查 gh 认证状态
 */
export async function checkGithubAuth(): Promise<Result<boolean>> {
  const tokenRes = await readGithubToken();

  if (!tokenRes.success) return failure(tokenRes.error);

  return success(true);
}

