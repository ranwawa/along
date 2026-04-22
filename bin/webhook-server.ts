#!/usr/bin/env bun
/**
 * webhook-server.ts - 本地 webhook 接收服务器
 *
 * 监听 GitHub App 直接推送的 webhook 事件，自动调用对应的处理函数。
 * 支持 HMAC-SHA256 签名验证确保请求来源可信。
 *
 * 用法：
 *   along webhook-server --port 9876 --secret <your-secret>
 */

import { Command } from "commander";
import { consola } from "consola";
import { $ } from "bun";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  reviewPr,
  resolveReview,
  resolveCi,
  cleanupIssueSession,
} from "./webhook-handlers";
import { triageIssue, handleTriagedIssue } from "./issue-triage";
import { launchIssueAgent, setDashboardMode } from "./issue-agent";
import { config } from "./config";
import { findAllSessions, readSession } from "./db";
import { check_process_running, calculate_runtime } from "./common";
import { setupLogInterceptor, getLogEntries } from "./log-buffer";
import { cleanupIssue, cleanupIssueAssets } from "./cleanup-utils";
import { syncLifecycleLabel } from "./github-client";
import {
  isActiveSessionStatus,
  EVENT,
  LIFECYCLE,
  COMMAND,
} from "./session-state-machine";
import { SessionManager } from "./session-manager";
import { SessionPathManager } from "./session-paths";
import {
  readSessionDiagnostic,
  readSessionLog,
  generateSessionDiagnostic,
  type SessionLogSource,
} from "./session-diagnostics";

const logger = consola.withTag("webhook-server");

// ── Agent 并发限制（防止同时启动过多 agent 耗尽资源） ──
const MAX_CONCURRENT_AGENTS = parseInt(
  process.env.ALONG_MAX_CONCURRENT_AGENTS || "3",
  10,
);
let runningAgents = 0;
const agentQueue: Array<{ fn: () => Promise<any>; label: string }> = [];

function enqueueAgent(label: string, fn: () => Promise<any>) {
  if (runningAgents < MAX_CONCURRENT_AGENTS) {
    runAgent(label, fn);
  } else {
    logger.info(
      `[并发限制] ${label} 已排队（当前 ${runningAgents}/${MAX_CONCURRENT_AGENTS} 运行中，队列 ${agentQueue.length} 个）`,
    );
    agentQueue.push({ fn, label });
  }
}

function runAgent(label: string, fn: () => Promise<any>) {
  runningAgents++;
  logger.info(
    `[并发限制] ${label} 开始执行（${runningAgents}/${MAX_CONCURRENT_AGENTS}）`,
  );
  fn()
    .catch((err) => {
      logger.error(`[并发限制] ${label} 执行异常: ${err.message}`);
    })
    .finally(() => {
      runningAgents--;
      logger.info(
        `[并发限制] ${label} 执行完毕（${runningAgents}/${MAX_CONCURRENT_AGENTS}，队列 ${agentQueue.length} 个）`,
      );
      // 从队列中取出下一个任务
      const next = agentQueue.shift();
      if (next) {
        runAgent(next.label, next.fn);
      }
    });
}

// ── Webhook 事件去重（防止 GitHub 超时重发） ──
const DEDUP_MAX_SIZE = 1000;
const processedDeliveries = new Set<string>();

function isDuplicateDelivery(deliveryId: string): boolean {
  if (!deliveryId || deliveryId === "-") return false;
  if (processedDeliveries.has(deliveryId)) return true;
  processedDeliveries.add(deliveryId);
  // 超过上限时清理最早的条目
  if (processedDeliveries.size > DEDUP_MAX_SIZE) {
    const first = processedDeliveries.values().next().value;
    if (first) processedDeliveries.delete(first);
  }
  return false;
}

/**
 * 验证 GitHub webhook HMAC-SHA256 签名
 */
function verifySignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!secret) return true;
  if (!signature || signature === "none") return false;

  const expected = `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

/**
 * 解析仓库信息
 */
function parseRepository(
  fullName: string,
): { owner: string; repo: string } | null {
  const parts = fullName.split("/");
  if (parts.length !== 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

/**
 * 异步执行处理函数（fire-and-forget，不阻塞 HTTP 响应）
 */
function fireAndForget(fn: () => Promise<any>) {
  fn().catch((err) => {
    logger.error(`处理函数执行内部异常: ${err.message}`);
  });
}

function getSessionQuery(
  url: URL,
): { owner: string; repo: string; issueNumber: number } | null {
  const owner = url.searchParams.get("owner") || "";
  const repo = url.searchParams.get("repo") || "";
  const issueNumber = Number(url.searchParams.get("issueNumber") || "");
  if (!owner || !repo || !issueNumber) return null;
  return { owner, repo, issueNumber };
}

/**
 * 处理 GitHub webhook 事件
 */
async function handleEvent(
  eventType: string,
  payload: any,
  deliveryId: string,
): Promise<{ status: number; message: string }> {
  const repoFullName = payload.repository?.full_name;
  if (!repoFullName) {
    return { status: 400, message: "缺少 repository 信息" };
  }

  const repoInfo = parseRepository(repoFullName);
  if (!repoInfo) {
    return { status: 400, message: `无效的仓库格式: ${repoFullName}` };
  }

  const { owner, repo } = repoInfo;
  const action = payload.action || "";
  logger.info(
    `[${deliveryId}] 收到事件: ${eventType}.${action} | 仓库: ${repoFullName}`,
  );

  switch (eventType) {
    case "issues": {
      const issueNumber = payload.issue?.number;
      if (!issueNumber) return { status: 400, message: "缺少 issue number" };

      if (action === "opened") {
        if (payload.sender?.type === "Bot") {
          return { status: 200, message: "忽略 Bot 创建的 Issue" };
        }

        const issueTitle = payload.issue?.title || "";
        const issueBody = payload.issue?.body || "";
        const issueLabels = (payload.issue?.labels || []).map((l: any) =>
          typeof l === "string" ? l : l.name,
        );

        logger.info(`Issue #${issueNumber} 已创建，开始分类...`);
        enqueueAgent(`Issue #${issueNumber} 分类+处理`, async () => {
          const triageRes = await triageIssue(
            issueTitle,
            issueBody,
            issueLabels,
          );
          if (!triageRes.success) {
            logger.error(
              `Issue #${issueNumber} 分类失败，终止处理: ${triageRes.error}`,
            );
            return;
          }

          const triageResult = triageRes.data;
          logger.info(
            `Issue #${issueNumber} 分类结果: ${triageResult.classification} (${triageResult.reason})`,
          );
          const handleRes = await handleTriagedIssue(
            owner,
            repo,
            issueNumber,
            triageResult,
          );
          if (!handleRes.success) {
            logger.error(`处理分类结果失败: ${handleRes.error}`);
          }
        });
        return { status: 202, message: `已触发 Issue #${issueNumber} 分类` };
      }

      if (action === "deleted") {
        logger.info(`收到 Issue #${issueNumber} 删除事件，启动资产清理...`);
        fireAndForget(async () => {
          const res = await cleanupIssueSession(owner, repo, issueNumber);
          if (!res.success) {
            logger.error(`Issue #${issueNumber} 资产清理失败: ${res.error}`);
          }
        });
        return {
          status: 202,
          message: `已触发 Issue #${issueNumber} 资产清理`,
        };
      }

      return { status: 200, message: `忽略 issues.${action} 事件` };
    }

    case "issue_comment": {
      if (action !== "created")
        return { status: 200, message: `忽略 issue_comment.${action} 事件` };

      const issueNumber = payload.issue?.number;
      if (!issueNumber) return { status: 400, message: "缺少 issue number" };

      const body = (payload.comment?.body || "").trim();
      const command = body.split(/\s/)[0]?.toLowerCase();

      if (command === COMMAND.APPROVE) {
        const issueLabels = (payload.issue?.labels || []).map((l: any) =>
          typeof l === "string" ? l : l.name,
        );
        if (
          !issueLabels.some((l: string) => l === "bug" || l === "enhancement")
        ) {
          return {
            status: 200,
            message: "非 bug/feature issue，忽略 /approve 指令",
          };
        }

        logger.info(
          `Issue #${issueNumber} 收到 /approve 指令，触发实现阶段...`,
        );
        const session = new SessionManager(owner, repo, issueNumber);
        await session.transition({ type: EVENT.APPROVED });

        enqueueAgent(`Issue #${issueNumber} 实现`, async () => {
          const res = await launchIssueAgent(
            owner,
            repo,
            issueNumber,
            "implementation",
            {
              taskData: { title: `Issue #${issueNumber}` },
            },
          );
          if (!res.success) logger.error(`启动实现阶段失败: ${res.error}`);
        });
        return {
          status: 202,
          message: `已触发实现阶段: Issue #${issueNumber}`,
        };
      }

      if (command === COMMAND.REJECT) {
        logger.info(`Issue #${issueNumber} 收到 /reject 指令`);
        const session = new SessionManager(owner, repo, issueNumber);
        await session.transition({
          type: EVENT.MANUAL_STATUS_UPDATE,
          lifecycle: LIFECYCLE.FAILED,
          message: "方案被拒绝",
        });
        return {
          status: 200,
          message: `Issue #${issueNumber} 已标记为 failed`,
        };
      }

      return { status: 200, message: "忽略非指令评论" };
    }

    case "pull_request": {
      const prNumber = payload.pull_request?.number;
      if (!prNumber) return { status: 400, message: "缺少 PR number" };

      if (action === "opened" || action === "synchronize") {
        logger.info(`PR #${prNumber} 事件: ${action}，启动代码审查...`);
        fireAndForget(async () => {
          await reviewPr(owner, repo, prNumber);
        });
        return { status: 202, message: `已触发代码审查 PR #${prNumber}` };
      }

      if (action === "closed" && payload.pull_request?.merged) {
        const body = payload.pull_request?.body || "";
        const issueMatch = body.match(/(?:fixes|closes|resolves)\s+#(\d+)/i);
        if (issueMatch) {
          const linkedIssue = Number(issueMatch[1]);
          logger.info(`PR #${prNumber} 已合并，处理 Issue #${linkedIssue}...`);
          fireAndForget(async () => {
            const session = new SessionManager(owner, repo, linkedIssue);
            await session.transition({ type: EVENT.PR_MERGED });
            await syncLifecycleLabel(
              owner,
              repo,
              linkedIssue,
              LIFECYCLE.COMPLETED,
            );

            logger.info(
              `PR #${prNumber} 已合并，开始清理 Issue #${linkedIssue} 的本地资源...`,
            );
            const cleanRes = await cleanupIssue(
              String(linkedIssue),
              { reason: "pr-merged", silent: false },
              owner,
              repo,
            );
            if (!cleanRes.success) {
              logger.warn(`清理 Issue #${linkedIssue} 失败: ${cleanRes.error}`);
            }
          });
          return {
            status: 202,
            message: `已触发资产回收: Issue #${linkedIssue}`,
          };
        }
        return { status: 200, message: "PR 已合并但未关联 issue" };
      }

      return { status: 200, message: `忽略 pull_request.${action} 事件` };
    }

    case "pull_request_review": {
      const prNumber = payload.pull_request?.number;
      if (!prNumber) return { status: 400, message: "缺少 PR number" };

      if (action === "submitted") {
        logger.info(`PR #${prNumber} 收到 review，启动评论处理...`);
        enqueueAgent(`PR #${prNumber} review 处理`, async () => {
          await resolveReview(owner, repo, prNumber);
        });
        return { status: 202, message: `已触发评论处理 PR #${prNumber}` };
      }

      return {
        status: 200,
        message: `忽略 pull_request_review.${action} 事件`,
      };
    }

    case "check_run": {
      if (action !== "completed") {
        return { status: 200, message: `忽略 check_run.${action} 事件` };
      }
      const conclusion = payload.check_run?.conclusion;
      if (conclusion !== "failure" && conclusion !== "timed_out") {
        return { status: 200, message: "CI 未失败，跳过" };
      }
      const pullRequests = payload.check_run?.pull_requests || [];
      if (pullRequests.length === 0) {
        return { status: 200, message: "check_run 未关联 PR，跳过" };
      }
      const prNumber = pullRequests[0].number;
      logger.info(`PR #${prNumber} CI 失败，启动修复...`);
      enqueueAgent(`PR #${prNumber} CI 修复`, async () => {
        await resolveCi(owner, repo, prNumber);
      });
      return { status: 202, message: `已触发 CI 修复 PR #${prNumber}` };
    }

    default:
      return { status: 200, message: `忽略事件: ${eventType}` };
  }
}

async function main() {
  const program = new Command()
    .name("along webhook-server")
    .description("启动本地 webhook 接收服务器，监听 GitHub App webhook 事件")
    .option("--port <port>", "监听端口", "9876")
    .option(
      "--secret <secret>",
      "Webhook 签名密钥（GitHub App 的 webhook secret）",
    )
    .option("--host <host>", "监听地址", "0.0.0.0")
    .option("--no-dashboard", "禁用终端 Dashboard，使用原始日志模式")
    .parse(process.argv);

  const opts = program.opts();
  const port = parseInt(opts.port, 10);
  const secret = opts.secret || process.env.ALONG_WEBHOOK_SECRET || "";
  const host = opts.host;
  const useDashboard = opts.dashboard !== false;

  if (useDashboard) {
    setupLogInterceptor();
  }

  if (!secret) {
    logger.warn("未设置 webhook secret，将接受所有请求（不推荐用于生产环境）");
  }

  const server = Bun.serve({
    hostname: host,
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // 健康检查
      if (url.pathname === "/health") {
        return new Response(
          JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Webhook 端点
      if (url.pathname === "/webhook" && req.method === "POST") {
        const body = await req.text();

        // 验证签名
        if (secret) {
          const signature = req.headers.get("X-Hub-Signature-256") || "";
          if (!verifySignature(body, signature, secret)) {
            logger.error("签名验证失败");
            return new Response(JSON.stringify({ error: "签名验证失败" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        let payload: any;
        try {
          payload = JSON.parse(body);
        } catch {
          return new Response(JSON.stringify({ error: "无效的 JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const githubEvent = req.headers.get("X-GitHub-Event") || "";
        const deliveryId = req.headers.get("X-GitHub-Delivery") || "-";

        // 事件去重：防止 GitHub 超时重发导致重复处理
        if (isDuplicateDelivery(deliveryId)) {
          logger.debug(`[${deliveryId}] 重复事件，跳过`);
          return new Response(JSON.stringify({ message: "重复事件，已忽略" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        // 处理 ping 事件（GitHub App 安装/配置时发送）
        if (githubEvent === "ping") {
          logger.success(
            `[${deliveryId}] 收到 GitHub ping 事件，zen: ${payload.zen}`,
          );
          return new Response(JSON.stringify({ message: "pong" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (!githubEvent) {
          return new Response(
            JSON.stringify({ error: "缺少 X-GitHub-Event header" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        const result = await handleEvent(githubEvent, payload, deliveryId);
        return new Response(JSON.stringify({ message: result.message }), {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      // ── CORS preflight ──
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // ── API: /api/sessions ──
      if (url.pathname === "/api/sessions" && req.method === "GET") {
        const allRes = findAllSessions();
        if (!allRes.success) {
          return new Response(
            JSON.stringify({ error: "Failed to load sessions" }),
            { status: 500 },
          );
        }
        const sessions = [];
        const worktreeList = await $`git worktree list`.text();
        for (const info of allRes.data) {
          const res = readSession(info.owner, info.repo, info.issueNumber);
          if (res.success && res.data) {
            let displayLifecycle = res.data.lifecycle;
            if (isActiveSessionStatus(displayLifecycle) && res.data.pid) {
              const alive = await check_process_running(res.data.pid);
              if (!alive) displayLifecycle = "zombie" as any;
            }
            sessions.push({
              ...res.data,
              lifecycle: displayLifecycle,
              owner: info.owner,
              repo: info.repo,
              runtime: calculate_runtime(res.data.startTime),
              hasWorktree: res.data.worktreePath
                ? worktreeList.includes(res.data.worktreePath)
                : false,
            });
          }
        }
        return new Response(JSON.stringify(sessions), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // ── API: /api/restart ──
      if (url.pathname === "/api/restart" && req.method === "POST") {
        try {
          const body = await req.json();
          const { owner, repo, issueNumber } = body;
          if (!owner || !repo || !issueNumber) {
            return new Response(
              JSON.stringify({ error: "Missing owner, repo, or issueNumber" }),
              {
                status: 400,
                headers: {
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": "*",
                },
              },
            );
          }
          logger.info(`手动重启 Issue #${issueNumber} (${owner}/${repo})...`);
          enqueueAgent(`Issue #${issueNumber} 手动重启`, async () => {
            const sessionRes = readSession(owner, repo, issueNumber);
            const phase =
              sessionRes.success && sessionRes.data?.phase
                ? sessionRes.data.phase
                : "planning";
            const title =
              sessionRes.success && sessionRes.data?.title
                ? sessionRes.data.title
                : `Issue #${issueNumber}`;
            const res = await launchIssueAgent(
              owner,
              repo,
              issueNumber,
              phase,
              { taskData: { title } },
            );
            if (!res.success)
              logger.error(`手动重启 Issue #${issueNumber} 失败: ${res.error}`);
          });
          return new Response(
            JSON.stringify({ message: `已触发重启 Issue #${issueNumber}` }),
            {
              status: 202,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            },
          );
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
      }

      // ── API: /api/cleanup ──
      if (url.pathname === "/api/cleanup" && req.method === "POST") {
        try {
          const body = await req.json();
          const { owner, repo, issueNumber } = body;
          if (!owner || !repo || !issueNumber) {
            return new Response(
              JSON.stringify({ error: "Missing owner, repo, or issueNumber" }),
              {
                status: 400,
                headers: {
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": "*",
                },
              },
            );
          }
          logger.info(
            `清理 Issue #${issueNumber} 的 worktree (${owner}/${repo})...`,
          );
          const res = await cleanupIssue(
            String(issueNumber),
            { force: true, reason: "dashboard", silent: true },
            owner,
            repo,
          );
          if (!res.success) {
            return new Response(JSON.stringify({ error: res.error }), {
              status: 500,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            });
          }
          return new Response(
            JSON.stringify({
              message: `已清理 Issue #${issueNumber} 的 worktree`,
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            },
          );
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
      }

      // ── API: /api/delete ──
      if (url.pathname === "/api/delete" && req.method === "POST") {
        try {
          const body = await req.json();
          const { owner, repo, issueNumber } = body;
          if (!owner || !repo || !issueNumber) {
            return new Response(
              JSON.stringify({ error: "Missing owner, repo, or issueNumber" }),
              {
                status: 400,
                headers: {
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": "*",
                },
              },
            );
          }
          logger.info(
            `彻底删除 Issue #${issueNumber} 的本地资产 (${owner}/${repo})...`,
          );
          const res = await cleanupIssueAssets(
            String(issueNumber),
            { force: true, reason: "dashboard-delete", silent: true },
            owner,
            repo,
          );
          if (!res.success) {
            return new Response(JSON.stringify({ error: res.error }), {
              status: 500,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            });
          }
          return new Response(
            JSON.stringify({
              message: `已彻底删除 Issue #${issueNumber} 的本地资产`,
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            },
          );
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
      }

      // ── API: /api/system-logs (SSE) ──
      if (url.pathname === "/api/system-logs" && req.method === "GET") {
        return new Response(
          new ReadableStream({
            start(controller) {
              const id = setInterval(() => {
                const logs = getLogEntries();
                controller.enqueue(`data: ${JSON.stringify(logs)}\n\n`);
              }, 2000);
              req.signal.addEventListener("abort", () => {
                clearInterval(id);
              });
            },
          }),
          {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }

      // ── API: /api/session-log ──
      if (url.pathname === "/api/session-log" && req.method === "GET") {
        const query = getSessionQuery(url);
        if (!query) {
          return new Response(
            JSON.stringify({ error: "Missing owner, repo, or issueNumber" }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            },
          );
        }

        const source = (url.searchParams.get("source") ||
          "system") as SessionLogSource;
        if (source !== "system" && source !== "agent" && source !== "merged") {
          return new Response(JSON.stringify({ error: "Invalid source" }), {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }

        const maxLines =
          Number(url.searchParams.get("maxLines") || "") || undefined;
        const paths = new SessionPathManager(
          query.owner,
          query.repo,
          query.issueNumber,
        );
        const logs = readSessionLog(paths, source, maxLines);
        return new Response(JSON.stringify(logs), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // ── API: /api/session-diagnostic ──
      if (url.pathname === "/api/session-diagnostic" && req.method === "GET") {
        const query = getSessionQuery(url);
        if (!query) {
          return new Response(
            JSON.stringify({ error: "Missing owner, repo, or issueNumber" }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            },
          );
        }

        const sessionRes = readSession(
          query.owner,
          query.repo,
          query.issueNumber,
        );
        if (!sessionRes.success || !sessionRes.data) {
          return new Response(JSON.stringify({ error: "Session not found" }), {
            status: 404,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }

        const paths = new SessionPathManager(
          query.owner,
          query.repo,
          query.issueNumber,
        );
        const diagnostic =
          readSessionDiagnostic(paths) ||
          generateSessionDiagnostic(sessionRes.data, paths);
        return new Response(JSON.stringify(diagnostic), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // ── API: /api/agent-conversation ──
      if (url.pathname === "/api/agent-conversation" && req.method === "GET") {
        const query = getSessionQuery(url);
        if (!query) {
          return new Response(
            JSON.stringify({ error: "Missing owner, repo, or issueNumber" }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            },
          );
        }

        const sessionRes = readSession(
          query.owner,
          query.repo,
          query.issueNumber,
        );
        if (!sessionRes.success || !sessionRes.data) {
          return new Response(JSON.stringify({ error: "Session not found" }), {
            status: 404,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }

        const claudeSessionId = sessionRes.data.claudeSessionId;
        const worktreePath = sessionRes.data.worktreePath;
        if (!claudeSessionId || !worktreePath) {
          return new Response(JSON.stringify([]), {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }

        const encodedPath = worktreePath
          .replace(/\/\./g, "--")
          .replace(/\//g, "-");
        const jsonlPath = path.join(
          process.env.HOME || "~",
          ".claude",
          "projects",
          encodedPath,
          `${claudeSessionId}.jsonl`,
        );

        if (!fs.existsSync(jsonlPath)) {
          return new Response(JSON.stringify([]), {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }

        try {
          const content = fs.readFileSync(jsonlPath, "utf-8");
          const messages: any[] = [];
          for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const record = JSON.parse(trimmed);
              const type = record.type;
              if (type === "user") {
                const text = Array.isArray(record.message?.content)
                  ? record.message.content
                      .filter((c: any) => c.type === "text")
                      .map((c: any) => c.text)
                      .join("\n")
                  : typeof record.message?.content === "string"
                    ? record.message.content
                    : "";
                if (text) {
                  messages.push({
                    type: "user",
                    content: text,
                    timestamp: record.timestamp,
                  });
                }
              } else if (type === "assistant") {
                const msgContent = record.message?.content;
                if (Array.isArray(msgContent)) {
                  const texts = msgContent
                    .filter((c: any) => c.type === "text" && c.text)
                    .map((c: any) => c.text);
                  const toolUses = msgContent.filter(
                    (c: any) => c.type === "tool_use",
                  );
                  if (texts.length > 0) {
                    messages.push({
                      type: "assistant",
                      content: texts.join("\n"),
                      timestamp: record.timestamp,
                    });
                  }
                  for (const tool of toolUses) {
                    messages.push({
                      type: "tool_use",
                      toolName: tool.name,
                      toolInput: JSON.stringify(tool.input ?? {}).slice(0, 500),
                      timestamp: record.timestamp,
                    });
                  }
                }
              } else if (type === "tool_result") {
                const msgContent = record.message?.content;
                if (Array.isArray(msgContent)) {
                  for (const c of msgContent) {
                    if (c.type === "tool_result") {
                      const text =
                        typeof c.content === "string"
                          ? c.content
                          : JSON.stringify(c.content);
                      messages.push({
                        type: "tool_result",
                        content: text.slice(0, 1000),
                        isError: c.is_error || false,
                        timestamp: record.timestamp,
                      });
                    }
                  }
                }
              }
            } catch {
              // skip malformed lines
            }
          }
          return new Response(JSON.stringify(messages), {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        } catch (e: any) {
          return new Response(
            JSON.stringify({
              error: `Failed to read conversation: ${e.message}`,
            }),
            {
              status: 500,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            },
          );
        }
      }

      // ── Static Web UI ──
      if (req.method === "GET" && useDashboard) {
        try {
          const webDist = path.join(import.meta.dir, "..", "web", "dist");
          const reqPath = url.pathname === "/" ? "/index.html" : url.pathname;
          const filePath = path.join(webDist, reqPath);

          // Check if it's a regular file that exists
          const file = Bun.file(filePath);
          if (await file.exists()) {
            return new Response(file);
          }

          // Fallback to index.html for SPA routing
          const fallbackFile = Bun.file(path.join(webDist, "index.html"));
          if (await fallbackFile.exists()) {
            return new Response(fallbackFile);
          }
        } catch (e) {}
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  logger.success(`Webhook 服务器已启动: http://${host}:${port}`);
  logger.info(`健康检查: http://${host}:${port}/health`);
  logger.info(`Webhook 端点: http://${host}:${port}/webhook`);
  if (secret) {
    logger.info("签名验证: 已启用");
  }

  // ── 优雅关闭 ──
  const shutdown = () => {
    logger.info("收到关闭信号，准备退出...");
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // ── Dashboard 模式 ──
  if (useDashboard) {
    setDashboardMode(true);
    const dashboardUrl = `http://localhost:${port}`;
    logger.info(`Web Dashboard 正在运行: ${dashboardUrl}`);
    try {
      // 尝试自动打开浏览器
      const { exec } = await import("child_process");
      exec(`start ${dashboardUrl}`);
    } catch (e) {}
  } else {
    logger.info("按 Ctrl+C 停止服务器");
  }
}

main().catch((err) => {
  logger.error("启动失败:", err);
  process.exit(1);
});
