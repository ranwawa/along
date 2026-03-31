#!/usr/bin/env bun
import { Command } from "commander";
import { get_gh_client } from "./github-client";
import { log_info, log_error, log_success, success, failure } from "./common";
import chalk from "chalk";

async function main() {
  const program = new Command();
  program
    .name("issue-details")
    .description("获取 Issue 详情并执行安全校验")
    .argument("<issue-number>", "Issue 编号")
    .parse();

  const [issueNumber] = program.args;

  try {
    const clientRes = await get_gh_client();
    if (!clientRes.success) {
      log_error(`GitHub 客户端初始化失败: ${clientRes.error}`);
      process.exit(1);
    }

    const issue = await clientRes.data.getIssue(issueNumber);

    // 1. 防御性校验：检查 Issue 是否已经关闭
    if (issue.state && issue.state.toUpperCase() === "CLOSED") {
      log_error(`[系统拦截] Issue #${issueNumber} 已经被标记为关闭 (CLOSED)。如果该任务已完成，请不要继续往下进行了，立刻停止这整个会话！`);
      process.exit(1);
    }

    // 2. 防御性校验：检查是否已经有一个机器人在处理 (WIP)
    const labels = issue.labels || [];
    const isWip = labels.some((label: any) => 
      typeof label === 'string' ? label.toUpperCase() === "WIP" : label.name.toUpperCase() === "WIP"
    );
    if (isWip) {
       log_error(`[系统拦截] Issue #${issueNumber} 当前已经打上了 WIP 标签。说明团队中可能已经有人或其他模型正在处理它了。为了防止冲突，请立即停止这整个会话并向上级汇报！`);
       process.exit(1);
    }

    log_success(`获取 Issue #${issueNumber} 上下文成功！校验通过。`);
  } catch (error: any) {
    log_error(`获取 Issue 详情失败: ${error.message}`);
    process.exit(1);
  }
}

main();
