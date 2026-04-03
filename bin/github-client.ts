import { $ } from "bun";
import { Octokit, RestEndpointMethodTypes } from "@octokit/rest";
import { success, failure, Result, git } from "./common";

export type GitHubIssue = RestEndpointMethodTypes["issues"]["get"]["response"]["data"];
export type GitHubPullRequest = RestEndpointMethodTypes["pulls"]["get"]["response"]["data"];
export type GitHubReviewComment = RestEndpointMethodTypes["pulls"]["listReviewComments"]["response"]["data"][number];

/**
 * GitHub API 客户端 (基于官方 Octokit 实现)
 */
export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(token: string, owner: string, repo: string) {
    this.octokit = new Octokit({ auth: token });
    this.owner = owner;
    this.repo = repo;
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

let cachedToken: string | null = null;
let cachedRepoInfo: { owner: string; repo: string } | null = null;
let cachedClient: GitHubClient | null = null;

/**
 * 获取 GitHub 认证 Token
 */
export async function readGithubToken(): Promise<Result<string>> {
  if (cachedToken) return success(cachedToken as string);
  if (process.env.GITHUB_TOKEN) {
    cachedToken = process.env.GITHUB_TOKEN;
    return success(cachedToken as string);
  }

  try {
    const token = await $`gh auth token`.text();
    cachedToken = token.trim();
    return success(cachedToken as string);
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

