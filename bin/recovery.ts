/**
 * recovery.ts - 会话恢复模块
 *
 * 提供孤立/崩溃会话的自动恢复能力：
 * - recoverSessions(): 扫描本地 session，恢复孤立（running+PID死亡）和崩溃的会话
 * - recoverMissedIssues(): 检查 GitHub 上遗漏的 Issue（服务器宕机期间创建的）
 * - startPeriodicHealthCheck() / stopPeriodicHealthCheck(): 定期健康检查
 */

import fs from "fs";
import path from "path";
import { consola } from "consola";
import { check_process_running } from "./common";
import { findAllSessions, SessionPathManager } from "./session-paths";
import { SessionManager, type SessionStatus } from "./session-manager";
import { launchIssueAgent } from "./issue-agent";
import { readGithubToken, GitHubClient } from "./github-client";
import { triageIssue, handleTriagedIssue } from "./issue-triage";

const logger = consola.withTag("recovery");

// ─── 常量 ──────────────────────────────────────────────────

const MAX_RETRY_COUNT = 3;
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟
const MISSED_ISSUE_LOOKBACK_HOURS = 24;

// ─── 并发控制 ──────────────────────────────────────────────

let recoveryInProgress = false;
const recoveringIssues = new Set<string>();

function issueKey(owner: string, repo: string, issueNumber: number): string {
  return `${owner}/${repo}#${issueNumber}`;
}

// ─── 类型 ──────────────────────────────────────────────────

export interface RecoveryReport {
  scannedSessions: number;
  orphanedFound: number;
  crashedFound: number;
  restarted: number;
  skippedMaxRetries: number;
  skippedClosed: number;
  missedIssuesFound: number;
  missedIssuesLaunched: number;
  errors: Array<{ issueKey: string; error: string }>;
}

function emptyReport(): RecoveryReport {
  return {
    scannedSessions: 0,
    orphanedFound: 0,
    crashedFound: 0,
    restarted: 0,
    skippedMaxRetries: 0,
    skippedClosed: 0,
    missedIssuesFound: 0,
    missedIssuesLaunched: 0,
    errors: [],
  };
}

// ─── 辅助函数 ──────────────────────────────────────────────

/**
 * 异步执行（fire-and-forget），不阻塞调用方
 */
function fireAndForget(fn: () => Promise<void>): void {
  fn().catch((err) => {
    logger.error(`恢复任务执行失败: ${err.message}`);
  });
}

/**
 * 读取 .along-mode 文件确定当前 phase（恢复时重跑同一 phase）
 */
function readCurrentPhase(issueDir: string): "phase1" | "phase2" {
  const modeFile = path.join(issueDir, ".along-mode");
  try {
    if (fs.existsSync(modeFile)) {
      const content = fs.readFileSync(modeFile, "utf-8").trim();
      if (content === "phase2") return "phase2";
    }
  } catch {}
  return "phase1";
}

/**
 * 从 status.json 或 issue.json 中读取 Issue 标题
 */
function readIssueTitle(paths: SessionPathManager, status: SessionStatus): string {
  if (status.title) return status.title;
  const issueFile = paths.getIssueFile();
  try {
    if (fs.existsSync(issueFile)) {
      const data = JSON.parse(fs.readFileSync(issueFile, "utf-8"));
      return data.title || `Issue #${status.issueNumber}`;
    }
  } catch {}
  return `Issue #${status.issueNumber}`;
}

// ─── recoverSessions ───────────────────────────────────────

/**
 * 扫描所有本地 session，恢复孤立和崩溃的会话
 *
 * - status="running" + PID 已死 → 标记为 crashed → 重启
 * - status="crashed" → 验证 Issue 仍 open → 重启（受重试上限约束）
 */
export async function recoverSessions(dryRun = false): Promise<RecoveryReport> {
  if (recoveryInProgress) {
    logger.warn("恢复任务正在执行中，跳过本次");
    return emptyReport();
  }

  recoveryInProgress = true;
  const report = emptyReport();

  try {
    const sessions = findAllSessions();
    report.scannedSessions = sessions.length;

    for (const sessionInfo of sessions) {
      const { owner, repo, issueNumber } = sessionInfo;
      const key = issueKey(owner, repo, issueNumber);

      try {
        const session = new SessionManager(owner, repo, issueNumber);
        const status = session.readStatus();
        if (!status) continue;

        // 跳过已完成/已清理的会话
        if (status.status === "completed" || status.status === "error") continue;
        if (status.cleanupTime) continue;

        // 检测孤立会话：status=running 但进程已死
        if (status.status === "running") {
          const pidAlive = status.pid ? await check_process_running(status.pid) : false;
          if (pidAlive) continue; // 进程仍在运行，跳过

          report.orphanedFound++;
          logger.warn(`发现孤立会话: ${key} (PID: ${status.pid || "无"}, 进程已死)`);

          if (!dryRun) {
            session.markAsCrashed("进程异常退出，由恢复系统检测到");
          }
          // 继续走崩溃恢复流程
        }

        // 崩溃会话恢复
        if (status.status === "crashed" || report.orphanedFound > 0) {
          report.crashedFound++;

          // 重新读取状态（可能刚被标记为 crashed）
          const currentStatus = session.readStatus();
          if (!currentStatus || currentStatus.status !== "crashed") continue;

          // 检查重试上限
          const retryCount = currentStatus.retryCount || 0;
          if (retryCount >= MAX_RETRY_COUNT) {
            report.skippedMaxRetries++;
            logger.warn(`${key} 已达到最大重试次数 (${MAX_RETRY_COUNT})，跳过恢复`);

            // 移除 WIP 标签，避免 Issue 永久阻塞
            if (!dryRun) {
              try {
                const tokenRes = await readGithubToken();
                if (tokenRes.success) {
                  const client = new GitHubClient(tokenRes.data, owner, repo);
                  await client.removeIssueLabel(issueNumber, "WIP");
                  logger.info(`已移除 ${key} 的 WIP 标签`);
                }
              } catch (e: any) {
                logger.warn(`移除 WIP 标签失败: ${e.message}`);
              }
            }
            continue;
          }

          // 验证 Issue 仍然 open
          try {
            const tokenRes = await readGithubToken();
            if (!tokenRes.success) {
              report.errors.push({ issueKey: key, error: `获取 Token 失败: ${tokenRes.error}` });
              continue;
            }
            const client = new GitHubClient(tokenRes.data, owner, repo);
            const issue = await client.getIssue(issueNumber);
            if (issue.state !== "open") {
              report.skippedClosed++;
              logger.info(`${key} 对应的 Issue 已关闭，跳过恢复`);
              continue;
            }
          } catch (e: any) {
            report.errors.push({ issueKey: key, error: `检查 Issue 状态失败: ${e.message}` });
            continue;
          }

          // 防止重复恢复
          if (recoveringIssues.has(key)) {
            logger.info(`${key} 正在恢复中，跳过`);
            continue;
          }

          const paths = new SessionPathManager(owner, repo, issueNumber);
          const phase = readCurrentPhase(paths.getIssueDir());
          const title = readIssueTitle(paths, currentStatus);

          if (dryRun) {
            logger.info(`[DRY-RUN] 将恢复 ${key} (phase=${phase}, retryCount=${retryCount})`);
            report.restarted++;
            continue;
          }

          // 执行恢复
          recoveringIssues.add(key);
          session.incrementRetry();
          logger.info(`恢复 ${key} (phase=${phase}, retryCount=${retryCount + 1}/${MAX_RETRY_COUNT})`);

          fireAndForget(async () => {
            try {
              await launchIssueAgent(owner, repo, issueNumber, phase, { title });
            } finally {
              recoveringIssues.delete(key);
            }
          });

          report.restarted++;
        }
      } catch (e: any) {
        report.errors.push({ issueKey: key, error: e.message });
        logger.error(`处理 ${key} 时出错: ${e.message}`);
      }
    }
  } finally {
    recoveryInProgress = false;
  }

  return report;
}

// ─── recoverMissedIssues ───────────────────────────────────

/**
 * 检查 GitHub 上遗漏的 Issue（服务器宕机期间创建的）
 *
 * 三类遗漏：
 * 1. 有 WIP 标签但无活跃 session → 启动 phase1
 * 2. 有 bug/enhancement 标签但无 WIP → 分类完成但未启动 → 添加 WIP + 启动 phase1
 * 3. 无标签的新 Issue → 走完整分类流程
 */
export async function recoverMissedIssues(
  owner: string,
  repo: string,
  dryRun = false,
): Promise<RecoveryReport> {
  const report = emptyReport();

  const tokenRes = await readGithubToken();
  if (!tokenRes.success) {
    logger.error(`获取 GitHub Token 失败: ${tokenRes.error}`);
    return report;
  }

  const client = new GitHubClient(tokenRes.data, owner, repo);
  const sinceDate = new Date(Date.now() - MISSED_ISSUE_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  // 获取所有本地 session 用于比对
  const localSessions = findAllSessions(owner, repo);
  const localIssueNumbers = new Set(localSessions.map((s) => s.issueNumber));

  // ── 类别 A: 有 WIP 标签但无活跃 session ──
  try {
    const wipIssues = await client.listIssues({ labels: "WIP", state: "open" });
    for (const issue of wipIssues) {
      const key = issueKey(owner, repo, issue.number);

      // 检查是否有活跃的本地 session
      if (localIssueNumbers.has(issue.number)) {
        const session = new SessionManager(owner, repo, issue.number);
        const status = session.readStatus();
        if (status && (status.status === "running" || status.status === "crashed")) {
          // recoverSessions() 已经处理了这些
          continue;
        }
      }

      // 无 session 或 session 已完成/错误 → 需要重新启动
      report.missedIssuesFound++;
      if (recoveringIssues.has(key)) continue;

      if (dryRun) {
        logger.info(`[DRY-RUN] 将恢复遗漏的 WIP Issue: ${key} (${issue.title})`);
        report.missedIssuesLaunched++;
        continue;
      }

      logger.info(`恢复遗漏的 WIP Issue: ${key} (${issue.title})`);
      recoveringIssues.add(key);
      fireAndForget(async () => {
        try {
          await launchIssueAgent(owner, repo, issue.number, "phase1", { title: issue.title });
        } finally {
          recoveringIssues.delete(key);
        }
      });
      report.missedIssuesLaunched++;
    }
  } catch (e: any) {
    logger.error(`检查 WIP Issue 失败: ${e.message}`);
    report.errors.push({ issueKey: `${owner}/${repo}:WIP`, error: e.message });
  }

  // ── 类别 B: 有 bug/enhancement 标签但无 WIP（分类完成但未启动） ──
  for (const label of ["bug", "enhancement"]) {
    try {
      const issues = await client.listIssues({ labels: label, state: "open", since: sinceDate });
      for (const issue of issues) {
        const labels = (issue.labels || []).map((l: any) => (typeof l === "string" ? l : l.name));
        if (labels.includes("WIP")) continue; // 已有 WIP，类别 A 已处理

        const key = issueKey(owner, repo, issue.number);
        if (recoveringIssues.has(key)) continue;

        // 检查是否已有完成的 session
        if (localIssueNumbers.has(issue.number)) {
          const session = new SessionManager(owner, repo, issue.number);
          const status = session.readStatus();
          if (status && status.status === "completed") continue;
        }

        report.missedIssuesFound++;

        if (dryRun) {
          logger.info(`[DRY-RUN] 将启动遗漏的 ${label} Issue: ${key} (${issue.title})`);
          report.missedIssuesLaunched++;
          continue;
        }

        logger.info(`启动遗漏的 ${label} Issue: ${key} (${issue.title})`);
        recoveringIssues.add(key);

        // 先添加 WIP 标签
        try {
          await client.addIssueLabels(issue.number, ["WIP"]);
        } catch (e: any) {
          logger.warn(`添加 WIP 标签失败: ${e.message}`);
        }

        fireAndForget(async () => {
          try {
            await launchIssueAgent(owner, repo, issue.number, "phase1", { title: issue.title });
          } finally {
            recoveringIssues.delete(key);
          }
        });
        report.missedIssuesLaunched++;
      }
    } catch (e: any) {
      logger.error(`检查 ${label} Issue 失败: ${e.message}`);
      report.errors.push({ issueKey: `${owner}/${repo}:${label}`, error: e.message });
    }
  }

  // ── 类别 C: 无标签的新 Issue（从未被分类） ──
  try {
    const recentIssues = await client.listIssues({ state: "open", since: sinceDate });
    for (const issue of recentIssues) {
      // 跳过 Bot 创建的 Issue
      if ((issue.user as any)?.type === "Bot") continue;

      // 跳过已有标签的（已被分类或手动处理）
      const labels = (issue.labels || []).map((l: any) => (typeof l === "string" ? l : l.name));
      if (labels.length > 0) continue;

      const key = issueKey(owner, repo, issue.number);
      if (recoveringIssues.has(key)) continue;

      // 跳过已有 session 的
      if (localIssueNumbers.has(issue.number)) continue;

      report.missedIssuesFound++;

      if (dryRun) {
        logger.info(`[DRY-RUN] 将分类遗漏的 Issue: ${key} (${issue.title})`);
        report.missedIssuesLaunched++;
        continue;
      }

      logger.info(`分类遗漏的 Issue: ${key} (${issue.title})`);
      recoveringIssues.add(key);

      fireAndForget(async () => {
        try {
          const triageResult = await triageIssue(issue.title, issue.body || "", []);
          logger.info(`Issue #${issue.number} 分类结果: ${triageResult.classification}`);
          await handleTriagedIssue(owner, repo, issue.number, triageResult);
        } catch (err: any) {
          logger.error(`Issue #${issue.number} 分类失败: ${err.message}`);
        } finally {
          recoveringIssues.delete(key);
        }
      });
      report.missedIssuesLaunched++;
    }
  } catch (e: any) {
    logger.error(`检查未分类 Issue 失败: ${e.message}`);
    report.errors.push({ issueKey: `${owner}/${repo}:unlabeled`, error: e.message });
  }

  return report;
}

// ─── 定期健康检查 ──────────────────────────────────────────

let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

export function startPeriodicHealthCheck(): void {
  if (healthCheckTimer) return;

  healthCheckTimer = setInterval(async () => {
    logger.debug("定期健康检查：扫描会话状态...");
    try {
      const report = await recoverSessions();
      if (report.restarted > 0) {
        logger.warn(`健康检查发现并重启了 ${report.restarted} 个会话`);
      } else if (report.orphanedFound > 0 || report.crashedFound > 0) {
        logger.info(`健康检查: 扫描 ${report.scannedSessions} 个会话，无需恢复`);
      }
    } catch (err: any) {
      logger.error(`健康检查失败: ${err.message}`);
    }
  }, HEALTH_CHECK_INTERVAL_MS);

  logger.info(`定期健康检查已启动 (间隔: ${HEALTH_CHECK_INTERVAL_MS / 1000}s)`);
}

export function stopPeriodicHealthCheck(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
    logger.info("定期健康检查已停止");
  }
}
