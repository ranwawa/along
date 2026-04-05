#!/usr/bin/env bun
/**
 * actions-init.ts - 自动部署 GitHub Actions workflow 到目标仓库
 *
 * 将 Along 内置的 workflow 模板复制到目标仓库的 .github/workflows/ 目录，
 * 并提示用户配置必要的 GitHub Secrets。
 *
 * 用法：
 *   along actions-init              # 在当前仓库初始化
 *   along actions-init --webhook-url http://example.com:9876  # 指定 webhook URL
 */

import { Command } from "commander";
import fs from "fs";
import path from "path";
import { consola } from "consola";
import chalk from "chalk";
import { config } from "./config";
import { checkGitRepo, git } from "./common";
import { readRepoInfo } from "./github-client";

const logger = consola.withTag("actions-init");

/**
 * 复制 workflow 文件到目标目录
 */
function copyWorkflows(sourceDir: string, targetDir: string): string[] {
  if (!fs.existsSync(sourceDir)) {
    logger.error(`Workflow 模板目录不存在: ${sourceDir}`);
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  const copied: string[] = [];

  for (const file of files) {
    const src = path.join(sourceDir, file);
    const dest = path.join(targetDir, file);

    if (fs.existsSync(dest)) {
      logger.warn(`已存在，将覆盖: ${file}`);
    }

    fs.copyFileSync(src, dest);
    copied.push(file);
    logger.success(`已复制: ${file}`);
  }

  return copied;
}

async function main() {
  const program = new Command()
    .name("along actions-init")
    .description("将 Along GitHub Actions workflow 部署到当前仓库")
    .option("--webhook-url <url>", "Along webhook 服务器 URL")
    .option("--dry-run", "仅显示将要执行的操作，不实际复制文件", false)
    .parse(process.argv);

  const opts = program.opts();

  // 验证 git 仓库
  const gitCheck = await checkGitRepo();
  if (!gitCheck.success) {
    logger.error(gitCheck.error);
    process.exit(1);
  }

  // 获取仓库根目录
  const repoRoot = (await git.revparse(["--show-toplevel"])).trim();
  const repoInfo = await readRepoInfo();

  const sourceDir = config.WORKFLOWS_DIR;
  const targetDir = path.join(repoRoot, ".github", "workflows");

  logger.info(`源目录: ${sourceDir}`);
  logger.info(`目标目录: ${targetDir}`);

  if (repoInfo.success) {
    logger.info(`仓库: ${repoInfo.data.owner}/${repoInfo.data.repo}`);
  }

  if (opts.dryRun) {
    logger.info("(Dry Run 模式，不会实际复制文件)");
    const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    for (const file of files) {
      logger.info(`  将复制: ${file}`);
    }
    return;
  }

  // 复制 workflow 文件
  const copied = copyWorkflows(sourceDir, targetDir);

  if (copied.length === 0) {
    logger.warn("没有找到 workflow 文件");
    return;
  }

  // 打印配置指引
  console.log("");
  console.log(chalk.bold.cyan("=== 配置指引 ==="));
  console.log("");
  console.log("已部署以下 workflow 文件:");
  for (const file of copied) {
    console.log(`  ${chalk.green("✓")} .github/workflows/${file}`);
  }
  console.log("");
  console.log(chalk.bold("接下来需要配置 GitHub Secrets:"));
  console.log("");
  console.log(`  1. 打开仓库 Settings → Secrets and variables → Actions`);
  console.log(`  2. 添加以下 Secrets:`);
  console.log("");
  console.log(`     ${chalk.yellow("ALONG_WEBHOOK_URL")}    - Along webhook 服务器地址`);
  if (opts.webhookUrl) {
    console.log(`       推荐值: ${chalk.cyan(opts.webhookUrl)}`);
  } else {
    console.log(`       示例: ${chalk.cyan("http://your-server:9876")}`);
  }
  console.log("");
  console.log(`     ${chalk.yellow("ALONG_WEBHOOK_SECRET")} - Webhook 签名密钥（可选但推荐）`);
  console.log(`       生成方式: ${chalk.cyan("openssl rand -hex 32")}`);
  console.log("");
  console.log(chalk.bold("启动 webhook 服务器:"));
  console.log(`  ${chalk.cyan("along webhook-server --port 9876 --secret <your-secret>")}`);
  console.log("");

  if (repoInfo.success) {
    console.log(chalk.bold("快速配置 Secrets (使用 gh CLI):"));
    const { owner, repo } = repoInfo.data;
    if (opts.webhookUrl) {
      console.log(`  ${chalk.cyan(`echo "${opts.webhookUrl}" | gh secret set ALONG_WEBHOOK_URL -R ${owner}/${repo}`)}`);
    }
    console.log(`  ${chalk.cyan(`openssl rand -hex 32 | gh secret set ALONG_WEBHOOK_SECRET -R ${owner}/${repo}`)}`);
    console.log("");
  }
}

main().catch((err) => {
  logger.error("初始化失败:", err);
  process.exit(1);
});
