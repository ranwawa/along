import { $ } from "bun";
import { Octokit, RestEndpointMethodTypes } from "@octokit/rest";
import { success, failure, Result, git } from "./common";
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

        apiLogger.warn(
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

  async getIssue(number: string | number): Promise<GitHubIssue> {
    const { data } = await this.octokit.issues.get({
      ...this.repoParams,
      issue_number: Number(number),
    });
    return data;
  }



  async getIssueComments(number: string | number): Promise<RestEndpointMethodTypes["issues"]["listComments"]["response"]["data"]> {
    const { data } = await this.octokit.issues.listComments({
      ...this.repoParams,
      issue_number: Number(number),
    });
    return data;
  }

  async addIssueComment(number: string | number, body: string): Promise<void> {
    await this.octokit.issues.createComment({
      ...this.repoParams,
      issue_number: Number(number),
      body,
    });
  }

  async addIssueLabels(number: string | number, labels: string[]): Promise<void> {
    await this.octokit.issues.addLabels({
      ...this.repoParams,
      issue_number: Number(number),
      labels,
    });
  }

  async removeIssueLabel(number: string | number, label: string): Promise<void> {
    try {
      await this.octokit.issues.removeLabel({
        ...this.repoParams,
        issue_number: Number(number),
        name: label,
      });
    } catch (e: any) {
      // 标签不存在时忽略 404
      if (e.status !== 404) throw e;
    }
  }

  async getRepositoryDetails(): Promise<RestEndpointMethodTypes["repos"]["get"]["response"]["data"]> {
    const { data } = await this.octokit.repos.get({
      ...this.repoParams,
    });
    return data;
  }

  async getPullRequest(prNumber: number): Promise<GitHubPullRequest> {
    const { data } = await this.octokit.pulls.get({
      ...this.repoParams,
      pull_number: prNumber,
    });
    return data;
  }

  async getReviewComments(prNumber: number): Promise<GitHubReviewComment[]> {
    const { data } = await this.octokit.pulls.listReviewComments({
      ...this.repoParams,
      pull_number: prNumber,
      per_page: 100,
    });
    return data;
  }

  async createReviewCommentReply(prNumber: number, commentId: number, body: string): Promise<void> {
    await this.octokit.pulls.createReplyForReviewComment({
      ...this.repoParams,
      pull_number: prNumber,
      comment_id: commentId,
      body,
    });
  }

  async getCheckRuns(ref: string): Promise<GitHubCheckRun[]> {
    const { data } = await this.octokit.checks.listForRef({
      ...this.repoParams,
      ref,
      per_page: 100,
    });
    return data.check_runs;
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
  ): Promise<void> {
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
  }

  /**
   * 列出 PR 上的所有 Reviews
   */
  async listReviews(prNumber: number): Promise<RestEndpointMethodTypes["pulls"]["listReviews"]["response"]["data"]> {
    const { data } = await this.octokit.pulls.listReviews({
      ...this.repoParams,
      pull_number: prNumber,
      per_page: 100,
    });
    return data;
  }

  /**
   * 获取 PR 变更文件列表（含 patch/diff）
   */
  async getPullRequestFiles(prNumber: number): Promise<RestEndpointMethodTypes["pulls"]["listFiles"]["response"]["data"]> {
    const { data } = await this.octokit.pulls.listFiles({
      ...this.repoParams,
      pull_number: prNumber,
      per_page: 100,
    });
    return data;
  }

  /**
   * 获取 PR 的完整 diff 文本
   */
  async getPullRequestDiff(prNumber: number): Promise<string> {
    const { data } = await this.octokit.pulls.get({
      ...this.repoParams,
      pull_number: prNumber,
      mediaType: { format: "diff" },
    });
    return data as unknown as string;
  }

}

/**
 * 检查是否为 404 / Not Found 错误
 */
export function isNotFoundError(e: any): boolean {
  if (!e) return false;

  // Octokit 典型的 status 属性
  if (e.status === 404) return true;

  // 备选方案：检查消息内容
  const message = e.message?.toLowerCase() || "";
  return message.includes("404") || message.includes("not found");
}

// 默认 token 缓存
let cachedDefaultToken: string | null = null;
let cachedRepoInfo: { owner: string; repo: string } | null = null;
let cachedClient: GitHubClient | null = null;

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
 */
export async function get_gh_client(): Promise<Result<GitHubClient>> {
  if (cachedClient) return success(cachedClient as GitHubClient);

  const tokenRes = await readGithubToken();
  if (!tokenRes.success) return failure(tokenRes.error);

  const repoRes = await readRepoInfo();
  if (!repoRes.success) return failure(repoRes.error);

  cachedClient = new GitHubClient(
    tokenRes.data,
    repoRes.data.owner,
    repoRes.data.repo
  );
  return success(cachedClient);
}

/**
 * 检查 gh 认证状态
 */
export async function checkGithubAuth(): Promise<Result<boolean>> {
  const tokenRes = await readGithubToken();

  if (!tokenRes.success) return failure(tokenRes.error);

  return success(true);
}

