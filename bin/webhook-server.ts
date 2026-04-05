#!/usr/bin/env bun
/**
 * webhook-server.ts - 本地 webhook 接收服务器
 *
 * 监听 GitHub Actions 转发的事件，自动调用对应的 along 子命令。
 * 支持 HMAC-SHA256 签名验证确保请求来源可信。
 *
 * 用法：
 *   along webhook-server --port 9876 --secret <your-secret>
 */

import { Command } from "commander";
import { consola } from "consola";
import crypto from "crypto";

const logger = consola.withTag("webhook-server");

interface WebhookPayload {
  event: string;
  issue_number?: number;
  pr_number?: number;
  repository: string;
  title?: string;
  labels?: string[];
  action?: string;
  event_name?: string;
  conclusion?: string;
}

/**
 * 验证 HMAC-SHA256 签名
 */
function verifySignature(payload: string, signature: string, secret: string): boolean {
  if (!secret) return true;
  if (!signature || signature === "none") return false;

  const expected = `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * 解析仓库信息
 */
function parseRepository(repository: string): { owner: string; repo: string } | null {
  const parts = repository.split("/");
  if (parts.length !== 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

/**
 * 处理 webhook 事件
 */
async function handleEvent(payload: WebhookPayload): Promise<{ status: number; message: string }> {
  const repoInfo = parseRepository(payload.repository);
  if (!repoInfo) {
    return { status: 400, message: `无效的仓库格式: ${payload.repository}` };
  }

  logger.info(`收到事件: ${payload.event} | 仓库: ${payload.repository}`);

  switch (payload.event) {
    case "issue.opened": {
      if (!payload.issue_number) {
        return { status: 400, message: "缺少 issue_number" };
      }
      logger.info(`Issue #${payload.issue_number} 已创建，启动 along run...`);
      const proc = Bun.spawn(["along", "run", String(payload.issue_number), "--ci"], {
        stdout: "inherit",
        stderr: "inherit",
      });
      // 不等待完成，异步执行
      proc.unref();
      return { status: 202, message: `已触发 along run ${payload.issue_number}` };
    }

    case "issue.approved": {
      if (!payload.issue_number) {
        return { status: 400, message: "缺少 issue_number" };
      }
      logger.info(`Issue #${payload.issue_number} 已审批，启动 Phase 2...`);
      // approved 事件：直接启动 Phase 2（along run 会检测 status 并进入 phase2）
      const proc = Bun.spawn(["along", "run", String(payload.issue_number), "--ci"], {
        stdout: "inherit",
        stderr: "inherit",
      });
      proc.unref();
      return { status: 202, message: `已触发 Phase 2: Issue #${payload.issue_number}` };
    }

    case "pr.opened":
    case "pr.synchronize": {
      if (!payload.pr_number) {
        return { status: 400, message: "缺少 pr_number" };
      }
      logger.info(`PR #${payload.pr_number} 事件: ${payload.action}，启动 review-watch...`);
      const proc = Bun.spawn(["along", "review-watch", String(payload.pr_number), "--ci"], {
        stdout: "inherit",
        stderr: "inherit",
      });
      proc.unref();
      return { status: 202, message: `已触发 review-watch PR #${payload.pr_number}` };
    }

    case "pr.submitted": {
      if (!payload.pr_number) {
        return { status: 400, message: "缺少 pr_number" };
      }
      logger.info(`PR #${payload.pr_number} 收到 review，启动 pr-watch...`);
      const proc = Bun.spawn(["along", "pr-watch", String(payload.pr_number), "--ci"], {
        stdout: "inherit",
        stderr: "inherit",
      });
      proc.unref();
      return { status: 202, message: `已触发 pr-watch PR #${payload.pr_number}` };
    }

    case "pr.completed": {
      if (!payload.pr_number || payload.conclusion !== "failure") {
        return { status: 200, message: "CI 未失败，跳过" };
      }
      logger.info(`PR #${payload.pr_number} CI 失败，启动修复...`);
      const proc = Bun.spawn(["along", "pr-watch", String(payload.pr_number), "--ci"], {
        stdout: "inherit",
        stderr: "inherit",
      });
      proc.unref();
      return { status: 202, message: `已触发 CI 修复 PR #${payload.pr_number}` };
    }

    default:
      logger.warn(`未知事件类型: ${payload.event}`);
      return { status: 400, message: `未知事件类型: ${payload.event}` };
  }
}

async function main() {
  const program = new Command()
    .name("along webhook-server")
    .description("启动本地 webhook 接收服务器，监听 GitHub Actions 事件")
    .option("--port <port>", "监听端口", "9876")
    .option("--secret <secret>", "Webhook 签名密钥（用于验证请求来源）")
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
          const signature = req.headers.get("X-Along-Signature") || "";
          if (!verifySignature(body, signature, secret)) {
            logger.error("签名验证失败");
            return new Response(JSON.stringify({ error: "签名验证失败" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        let payload: WebhookPayload;
        try {
          payload = JSON.parse(body);
        } catch {
          return new Response(JSON.stringify({ error: "无效的 JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const result = await handleEvent(payload);
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
