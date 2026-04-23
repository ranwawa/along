import fs from "fs";
import path from "path";
import chalk from "chalk";
import { consola } from "consola";
import { success, failure } from "./result";
import type { Result } from "./result";
import { config } from "./config";
import { syncEditorMappings } from "./worktree-init";
import { ensureEditorPermissions } from "./common";
import { getWebhookSecret } from "./agent-config";
import { readRepoInfo } from "./github-client";

const logger = consola.withTag("bootstrap");

export async function ensureProjectBootstrap(): Promise<Result<void>> {
  const workingDir = process.cwd();
  const alongJsonPath = path.join(workingDir, ".along.json");

  if (!fs.existsSync(alongJsonPath)) {
    const tagRes = config.getLogTag();
    if (tagRes.success) {
      try {
        fs.writeFileSync(alongJsonPath, JSON.stringify({ agent: tagRes.data }, null, 2) + "\n");
        logger.info(`已自动创建 .along.json (agent: ${tagRes.data})`);
      } catch (e: any) {
        logger.warn(`创建 .along.json 失败: ${e.message}`);
      }
    }
  }

  const tagRes = config.getLogTag();
  if (!tagRes.success) {
    return failure(tagRes.error);
  }

  const editor = config.EDITORS.find(e => e.id === tagRes.data);
  if (editor) {
    const syncRes = syncEditorMappings(workingDir, editor);
    if (!syncRes.success) {
      logger.warn(`编辑器映射同步失败: ${syncRes.error}`);
    }
    ensureEditorPermissions(workingDir);
  }

  return success(undefined);
}

export async function ensureWebhookSecret(opts: { secret?: string }): Promise<Result<string>> {
  if (opts.secret) return success(opts.secret);

  const envSecret = process.env.ALONG_WEBHOOK_SECRET;
  if (envSecret) return success(envSecret);

  const configSecret = getWebhookSecret();
  if (configSecret) return success(configSecret);

  console.log("");
  console.log(chalk.bold.red("错误: 未配置 webhook secret"));
  console.log("");
  console.log("请通过以下方式之一提供 webhook secret:");
  console.log(`  1. ${chalk.cyan("along webhook-server --secret <secret>")}`);
  console.log(`  2. 设置环境变量 ${chalk.cyan("ALONG_WEBHOOK_SECRET=<secret>")}`);
  console.log(`  3. 在 ${chalk.cyan("~/.along/config.json")} 中添加 ${chalk.cyan('"webhookSecret": "<secret>"')}`);
  console.log("");
  console.log("如果你还没有创建 GitHub App，请按以下步骤操作:");
  console.log("");
  await printGitHubAppGuide();

  return failure("未配置 webhook secret");
}

export async function printGitHubAppGuide() {
  const repoInfo = await readRepoInfo();

  console.log(chalk.bold.cyan("╔══════════════════════════════════════════════════╗"));
  console.log(chalk.bold.cyan("║        Along — GitHub App 配置指引               ║"));
  console.log(chalk.bold.cyan("╚══════════════════════════════════════════════════╝"));
  console.log("");
  console.log("Along 通过 GitHub App webhook 直接接收仓库事件，无需 GitHub Actions 中转。");
  console.log(`详细文档请参考: ${chalk.cyan("docs/github-app-setup.md")}`);
  console.log("");

  console.log(chalk.bold.cyan("─── Step 1: 创建 GitHub App ───"));
  console.log("");
  console.log(`  打开 ${chalk.cyan("https://github.com/settings/apps/new")}`);
  console.log("");
  console.log(chalk.bold("  [基本信息]"));
  console.log(`  ${chalk.yellow("GitHub App name")}                  - 任意名称，如 ${chalk.cyan("along-webhook")}`);
  console.log(`  ${chalk.yellow("Description")}                      - ${chalk.dim("(可选)")} 如 ${chalk.cyan("Along 自动化 webhook 接收器")}`);
  console.log(`  ${chalk.yellow("Homepage URL")}                     - 任意 URL，如 ${chalk.cyan("https://github.com")}`);
  console.log("");
  console.log(chalk.bold("  [用户授权 — 全部跳过]"));
  console.log(`  ${chalk.yellow("Callback URL")}                     - ${chalk.dim("留空")}`);
  console.log(`  ${chalk.yellow("Expire user authorization tokens")} - ${chalk.dim("默认即可")}`);
  console.log(`  ${chalk.yellow("Request user authorization")}       - ${chalk.dim("不勾选")}`);
  console.log(`  ${chalk.yellow("Enable Device Flow")}               - ${chalk.dim("不勾选")}`);
  console.log("");
  console.log(chalk.bold("  [安装后 — 全部跳过]"));
  console.log(`  ${chalk.yellow("Setup URL")}                        - ${chalk.dim("留空")}`);
  console.log(`  ${chalk.yellow("Redirect on update")}               - ${chalk.dim("不勾选")}`);
  console.log("");

  console.log(chalk.bold.cyan("─── Step 2: 配置 Webhook ───"));
  console.log("");
  console.log(`  ${chalk.yellow("Active")}                           - ${chalk.green("✓ 勾选")}`);
  console.log(`  ${chalk.yellow("Webhook URL")}                      - ${chalk.cyan("<你的公网地址>/webhook")}`);
  console.log("");
  console.log("    需要通过隧道工具将本地端口暴露到公网:");
  console.log(`    ${chalk.cyan("ngrok http 9876")}                    → 复制生成的 https://xxx.ngrok-free.app`);
  console.log(`    ${chalk.cyan("cloudflared tunnel --url http://localhost:9876")}  → 复制生成的 https://xxx.trycloudflare.com`);
  console.log(`  ${chalk.yellow("Webhook secret")}                   - 用以下命令生成:`);
  console.log(`                                     ${chalk.cyan("openssl rand -hex 32")}`);
  console.log(`                                     ${chalk.dim("记下这个值，启动 webhook-server 时要用")}`);
  console.log("");

  console.log(chalk.bold.cyan("─── Step 3: 设置权限 (Repository permissions) ───"));
  console.log("");
  console.log("  只需设置以下 4 项，其余全部保持 No access:");
  console.log("");
  console.log(`  ${chalk.yellow("Issues")}           → ${chalk.cyan("Read & write")}   读取 Issue 内容、管理标签`);
  console.log(`  ${chalk.yellow("Pull requests")}    → ${chalk.cyan("Read-only")}      读取 PR 信息`);
  console.log(`  ${chalk.yellow("Checks")}           → ${chalk.cyan("Read-only")}      读取 CI 运行结果`);
  console.log(`  ${chalk.yellow("Metadata")}         → ${chalk.cyan("Read-only")}      ${chalk.dim("(默认已勾选，不可取消)")}`);
  console.log("");
  console.log(chalk.dim("  Organization permissions / Account permissions → 全部保持默认，不需要改"));
  console.log("");

  console.log(chalk.bold.cyan("─── Step 4: 订阅事件 (Subscribe to events) ───"));
  console.log("");
  console.log("  勾选以下 5 个事件（设置权限后才会出现对应选项）:");
  console.log("");
  console.log(`  ${chalk.green("☑")} Issues                    Issue 创建、标签变更等`);
  console.log(`  ${chalk.green("☑")} Issue comments             Issue 评论（/approve 等指令）`);
  console.log(`  ${chalk.green("☑")} Pull request              PR 创建、代码更新等`);
  console.log(`  ${chalk.green("☑")} Pull request review       PR Review 提交`);
  console.log(`  ${chalk.green("☑")} Check run                 CI 运行完成`);
  console.log("");
  console.log(chalk.dim("  其余事件不要勾选"));
  console.log("");

  console.log(chalk.bold.cyan("─── Step 5: 安装范围 ───"));
  console.log("");
  console.log(`  ${chalk.green("◉")} Only on this account      ${chalk.dim("只在自己账号下使用")}`);
  console.log(`  ${chalk.dim("○")} Any account                ${chalk.dim("不需要")}`);
  console.log("");
  console.log(`  点击 ${chalk.bold.green("Create GitHub App")} 按钮完成创建`);
  console.log("");

  console.log(chalk.bold.cyan("─── Step 6: 安装 App 到仓库 ───"));
  console.log("");
  console.log("  创建完成后会跳转到 App 设置页:");
  console.log(`  1. 点击左侧菜单 ${chalk.cyan("Install App")}`);
  console.log(`  2. 点击你的账号旁边的 ${chalk.cyan("Install")} 按钮`);
  if (repoInfo.success) {
    const { owner, repo } = repoInfo.data;
    console.log(`  3. 选择 ${chalk.cyan("Only select repositories")} → 选中 ${chalk.cyan(`${owner}/${repo}`)}`);
  } else {
    console.log(`  3. 选择 ${chalk.cyan("Only select repositories")} → 选中目标仓库`);
  }
  console.log(`  4. 点击 ${chalk.bold.green("Install")} 完成安装`);
  console.log("");

  console.log(chalk.bold.cyan("─── Step 7: 启动 webhook 服务器 ───"));
  console.log("");
  console.log(`  ${chalk.cyan("along webhook-server --port 9876 --secret <你的-webhook-secret>")}`);
  console.log("");
  console.log("  验证是否正常工作:");
  console.log(`  1. 在目标仓库创建一个测试 Issue`);
  console.log(`  2. 观察 webhook-server 终端是否输出 ${chalk.green("收到事件: issues.opened")}`);
  console.log("");

  console.log(chalk.bold.cyan("─── 事件映射 ───"));
  console.log("");
  console.log("  GitHub App 推送的事件将自动触发以下命令:");
  console.log("");
  console.log(`  ${chalk.yellow("issues.opened")}              → triageIssue + agent         ${chalk.dim("新 Issue 自动分类处理")}`);
  console.log(`  ${chalk.yellow("issue_comment (/approve)")}   → launchIssueAgent(impl)      ${chalk.dim("Phase 2 自动启动")}`);
  console.log(`  ${chalk.yellow("issue_comment (/reject)")}    → session.failed               ${chalk.dim("方案被拒绝")}`);
  console.log(`  ${chalk.yellow("pull_request.opened")}        → reviewPr()                  ${chalk.dim("自动代码审查")}`);
  console.log(`  ${chalk.yellow("pull_request.synchronize")}   → reviewPr()                  ${chalk.dim("代码更新后重新审查")}`);
  console.log(`  ${chalk.yellow("pull_request_review")}        → resolveReview()             ${chalk.dim("处理 Review 反馈")}`);
  console.log(`  ${chalk.yellow("check_run.completed")}        → resolveCi()                 ${chalk.dim("CI 失败自动修复")}`);
  console.log("");
}
