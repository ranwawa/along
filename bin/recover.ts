#!/usr/bin/env bun
/**
 * recover.ts - 会话恢复 CLI 子命令
 *
 * 用法：
 *   along recover              # 扫描并恢复所有孤立/崩溃的 session
 *   along recover --dry-run    # 仅预览，不执行恢复
 *   along recover --missed     # 同时检查 GitHub 上遗漏的 Issue
 */

import { Command } from "commander";
import { consola } from "consola";
import { readRepoInfo } from "./github-client";
import { recoverSessions, recoverMissedIssues, type RecoveryReport } from "./recovery";

const logger = consola.withTag("recover");

function printReport(label: string, report: RecoveryReport): void {
  logger.info(`\n── ${label} ──`);
  logger.info(`  扫描会话数: ${report.scannedSessions}`);
  logger.info(`  孤立会话: ${report.orphanedFound}`);
  logger.info(`  崩溃会话: ${report.crashedFound}`);
  logger.info(`  已重启: ${report.restarted}`);
  logger.info(`  跳过(重试上限): ${report.skippedMaxRetries}`);
  logger.info(`  跳过(已关闭): ${report.skippedClosed}`);

  if (report.missedIssuesFound > 0 || report.missedIssuesLaunched > 0) {
    logger.info(`  遗漏 Issue: ${report.missedIssuesFound}`);
    logger.info(`  已启动: ${report.missedIssuesLaunched}`);
  }

  if (report.errors.length > 0) {
    logger.warn(`  错误 (${report.errors.length}):`);
    for (const e of report.errors) {
      logger.warn(`    - ${e.issueKey}: ${e.error}`);
    }
  }
}

async function main() {
  const program = new Command()
    .name("along recover")
    .description("扫描并恢复孤立/崩溃的 session")
    .option("--dry-run", "仅预览，不执行恢复操作")
    .option("--missed", "同时检查 GitHub 上遗漏的 Issue")
    .parse(process.argv);

  const opts = program.opts();
  const dryRun = !!opts.dryRun;
  const checkMissed = !!opts.missed;

  if (dryRun) {
    logger.info("[DRY-RUN] 仅预览模式，不会执行任何恢复操作\n");
  }

  // 1. 恢复孤立/崩溃会话
  logger.info("扫描本地会话...");
  const sessionReport = await recoverSessions(dryRun);
  printReport("会话恢复", sessionReport);

  // 2. 检查遗漏的 Issue（可选）
  if (checkMissed) {
    const repoRes = await readRepoInfo();
    if (!repoRes.success) {
      logger.error(`无法获取仓库信息: ${repoRes.error}`);
      logger.info("提示: 请在 git 仓库目录下运行此命令");
      process.exit(1);
      return; // unreachable, helps TS narrowing
    }

    const { owner, repo } = repoRes.data;
    logger.info(`\n检查 GitHub 上遗漏的 Issue (${owner}/${repo})...`);
    const missedReport = await recoverMissedIssues(owner, repo, dryRun);
    printReport("遗漏 Issue 恢复", missedReport);
  }

  logger.success("\n恢复流程完成");
}

main().catch((err) => {
  logger.error("恢复失败:", err);
  process.exit(1);
});
