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
import crypto from "crypto";
import { reviewPr, resolveReview, resolveCi } from "./webhook-handlers";
import { triageIssue, handleTriagedIssue } from "./issue-triage";

const logger = consola.withTag("webhook-server");

/**
 * 验证 GitHub webhook HMAC-SHA256 签名
 */
function verifySignature(payload: string, signature: string, secret: string): boolean {
  if (!secret) return true;
  if (!signature || signature === "none") return false;

  const expected = `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * 解析仓库信息
 */
function parseRepository(fullName: string): { owner: string; repo: string } | null {
  const parts = fullName.split("/");
  if (parts.length !== 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

/**
 * 异步执行处理函数（fire-and-forget，不阻塞 HTTP 响应）
 */
function fireAndForget(fn: () => Promise<void>) {
  fn().catch((err) => {
    logger.error(`处理函数执行失败: ${err.message}`);
  });
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
  logger.info(`[${deliveryId}] 收到事件: ${eventType}.${action} | 仓库: ${repoFullName}`);

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
          typeof l === "string" ? l : l.name
        );

        logger.info(`Issue #${issueNumber} 已创建，开始分类...`);
        fireAndForget(async () => {
          try {
            const triageResult = await triageIssue(issueTitle, issueBody, issueLabels);
            logger.info(`Issue #${issueNumber} 分类结果: ${triageResult.classification} (${triageResult.reason})`);
            await handleTriagedIssue(owner, repo, issueNumber, triageResult);
          } catch (err: any) {
            logger.error(`Issue #${issueNumber} 分类失败，回退到完整流程: ${err.message}`);
            const proc = Bun.spawn(["along", "run", String(issueNumber), "--ci"], {
              stdout: "inherit",
              stderr: "inherit",
            });
            proc.unref();
          }
        });
        return { status: 202, message: `已触发 Issue #${issueNumber} 分类` };
      }

      if (action === "labeled" && payload.label?.name === "approved") {
        logger.info(`Issue #${issueNumber} 已审批，启动 Phase 2...`);
        const proc = Bun.spawn(["along", "run", String(issueNumber), "--ci"], {
          stdout: "inherit",
          stderr: "inherit",
        });
        proc.unref();
        return { status: 202, message: `已触发 Phase 2: Issue #${issueNumber}` };
      }

      return { status: 200, message: `忽略 issues.${action} 事件` };
    }

    case "pull_request": {
      const prNumber = payload.pull_request?.number;
      if (!prNumber) return { status: 400, message: "缺少 PR number" };

      if (action === "opened" || action === "synchronize") {
        logger.info(`PR #${prNumber} 事件: ${action}，启动代码审查...`);
        fireAndForget(() => reviewPr(owner, repo, prNumber));
        return { status: 202, message: `已触发代码审查 PR #${prNumber}` };
      }

      return { status: 200, message: `忽略 pull_request.${action} 事件` };
    }

    case "pull_request_review": {
      const prNumber = payload.pull_request?.number;
      if (!prNumber) return { status: 400, message: "缺少 PR number" };

      if (action === "submitted") {
        logger.info(`PR #${prNumber} 收到 review，启动评论处理...`);
        fireAndForget(() => resolveReview(owner, repo, prNumber));
        return { status: 202, message: `已触发评论处理 PR #${prNumber}` };
      }

      return { status: 200, message: `忽略 pull_request_review.${action} 事件` };
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
      fireAndForget(() => resolveCi(owner, repo, prNumber));
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
    .option("--secret <secret>", "Webhook 签名密钥（GitHub App 的 webhook secret）")
    .option("--host <host>", "监听地址", "0.0.0.0")
    .parse(process.argv);

  const opts = program.opts();
  const port = parseInt(opts.port, 10);
  const secret = opts.secret || process.env.ALONG_WEBHOOK_SECRET || "";
  const host = opts.host;

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
        return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), {
          headers: { "Content-Type": "application/json" },
        });
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

        // 处理 ping 事件（GitHub App 安装/配置时发送）
        if (githubEvent === "ping") {
          logger.success(`[${deliveryId}] 收到 GitHub ping 事件，zen: ${payload.zen}`);
          return new Response(JSON.stringify({ message: "pong" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (!githubEvent) {
          return new Response(JSON.stringify({ error: "缺少 X-GitHub-Event header" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const result = await handleEvent(githubEvent, payload, deliveryId);
        return new Response(JSON.stringify({ message: result.message }), {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        });
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
  logger.info("按 Ctrl+C 停止服务器");
}

main().catch((err) => {
  logger.error("启动失败:", err);
  process.exit(1);
});
