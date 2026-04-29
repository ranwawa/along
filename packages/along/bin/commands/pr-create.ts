#!/usr/bin/env bun
import { $ } from 'bun';
import { Command } from 'commander';
import { consola } from 'consola';
import fs from 'fs';
import { iso_timestamp } from '../core/common';

const logger = consola.withTag('pr-create');

import { SessionPathManager } from '../core/session-paths';
import { SessionManager } from '../domain/session-manager';
import { completeTodoStep, saveStepOutput } from '../domain/todo-helper';
import { getDefaultBranch } from '../domain/worktree-init';
import { readGithubToken, readRepoInfo } from '../integration/github-client';

/**
 * pr-create.ts - 创建 Pull Request
 *
 * 从数据库读取分支和仓库信息，通过 gh CLI 创建 PR。
 * 不移除 running 标签（running 在 PR 合并到默认分支后才移除）。
 */

async function main() {
  const program = new Command();
  program
    .name('pr-create')
    .description('创建 Pull Request')
    .argument('<issue-number>', 'Issue 编号')
    .argument('<title>', 'PR 标题')
    .argument('<body>', 'PR 详细描述')
    .parse();

  const [issueNumber, title, body] = program.args;

  if (!issueNumber || !title || !body) {
    logger.error('缺少必要参数: issue-number, title, body');
    process.exit(1);
  }

  const repoInfoRes = await readRepoInfo();
  if (!repoInfoRes.success) {
    logger.error(repoInfoRes.error);
    process.exit(1);
  }
  const { owner, repo: repoName } = repoInfoRes.data;
  const paths = new SessionPathManager(owner, repoName, Number(issueNumber));
  const session = new SessionManager(owner, repoName, Number(issueNumber));

  const statusRes = session.readStatus();
  if (!statusRes.success) {
    logger.error(`读取会话状态失败: ${statusRes.error}`);
    process.exit(1);
  }
  const statusData = statusRes.data;
  if (!statusData) {
    logger.error('会话状态不存在，请先执行 run 检查或重置状态');
    process.exit(1);
  }

  const branchName = statusData.context?.branchName;
  const repo = statusData.repo;

  if (!branchName) {
    logger.error('状态中缺少 branchName，请先执行 branch-create');
    process.exit(1);
  }

  if (!repo?.owner || !repo?.name) {
    logger.error('状态中缺少仓库信息');
    process.exit(1);
  }

  const worktreePath = paths.getWorktreeDir();

  const defaultBranchRes = await getDefaultBranch();
  if (!defaultBranchRes.success) {
    logger.error(defaultBranchRes.error);
    process.exit(1);
  }
  const defaultBranch = defaultBranchRes.data;
  logger.info(`创建 PR: ${branchName} -> ${defaultBranch}`);

  // 使用当前认证 token（可能是 agent 角色 token）确保 gh CLI 使用正确身份
  const tokenRes = await readGithubToken();
  const ghEnv = tokenRes.success
    ? { ...process.env, GH_TOKEN: tokenRes.data }
    : { ...process.env };

  // 自动追加 fixes: #issueNumber 确保 PR 与 Issue 关联
  const linkedBody = body.endsWith(`fixes: #${issueNumber}`)
    ? body
    : `${body}\n\nfixes: #${issueNumber}`;

  try {
    const result = await $`gh pr create \
      --repo ${repo.owner}/${repo.name} \
      --head ${branchName} \
      --base ${defaultBranch} \
      --title ${title} \
      --body ${linkedBody}`
      .cwd(worktreePath)
      .env(ghEnv)
      .text();

    const prUrl = result.trim();
    logger.success(`PR 创建成功: ${prUrl}`);

    // 提取 PR number
    const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
    const prNum = prNumberMatch ? Number(prNumberMatch[1]) : undefined;

    // 更新数据库：记录 PR URL，保持 running 状态
    const writeRes = await session.transition({
      type: 'PR_CREATED',
      prUrl,
      prNumber: prNum,
      message: 'PR 已创建',
    });
    if (!writeRes.success) {
      logger.warn(`更新 PR 状态失败: ${writeRes.error}`);
    }

    // 记录到 session.log
    session.logEvent('pr-created', {
      prUrl,
      prNumber: prNum,
      title,
      branchName,
    });

    // 输出 PR URL 供模型使用
    console.log(prUrl);

    // 自动更新 todo
    const outputContent = [
      `# 第五步：创建 PR`,
      ``,
      `- **PR URL**: ${prUrl}`,
      `- **标题**: ${title}`,
      `- **分支**: ${branchName} -> ${defaultBranch}`,
      ``,
      `## PR 描述`,
      ``,
      linkedBody,
    ].join('\n');
    const outputFile = saveStepOutput(paths, 5, 'pr-create', outputContent);
    completeTodoStep(paths, 5, `PR: ${prUrl}`, outputFile);
  } catch (error: any) {
    session.log(
      `pr-create 失败: ${error.message}\n${error.stack || ''}`,
      'error',
    );
    logger.error(`PR 创建失败: ${error.message}`);
    process.exit(1);
  }
}

main();
