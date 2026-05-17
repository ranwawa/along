import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readGhToken } from '../../core/git-token';
import type { Result } from '../../core/result';
import { success } from '../../core/result';
import type { TaskPlanningSnapshot } from '../planning';
import type { DeliveryContext, TaskDeliveryCommandRunner } from './helpers';
import { defaultTaskWorktreeCommandRunner, failDeliveryRun } from './helpers';

const TITLE_MAX_WITH_SEQ = 80;
const TITLE_MAX_WITHOUT_SEQ = 90;
const TITLE_DEFAULT_MAX = 60;
const HEX_RADIX = 16;
const HEX_SLICE_START = 2;

export function normalizeTitle(
  title: string,
  maxLength = TITLE_DEFAULT_MAX,
): string {
  const text = title.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

export function parsePrNumber(prUrl: string): number | undefined {
  const match = prUrl.match(/\/pull\/(\d+)/);
  return match ? Number(match[1]) : undefined;
}

export function buildPrTitle(
  seq: number | undefined | null,
  title: string,
): string {
  return seq != null
    ? `Task #${seq}: ${normalizeTitle(title, TITLE_MAX_WITH_SEQ)}`
    : `Task: ${normalizeTitle(title, TITLE_MAX_WITHOUT_SEQ)}`;
}

export function buildPrBody(input: {
  taskId: string;
  seq?: number;
  planBody: string;
  changedFiles: string[];
  branchName: string;
  commitSha: string;
}): string {
  const changedFileLines = input.changedFiles
    .map((file) => `- \`${file}\``)
    .join('\n');
  return [
    input.seq != null
      ? `along-task: #${input.seq}`
      : `along-task: ${input.taskId}`,
    '',
    '## 修改内容',
    changedFileLines || '- 已按批准方案完成代码实现',
    '',
    '## 执行步骤',
    '1. 读取 Task 已批准方案',
    '2. 确认实施阶段已完成本地 commit',
    `3. 推送分支 \`${input.branchName}\``,
    '4. 创建 Pull Request',
    '',
    '## 影响范围',
    '- 影响范围以已批准方案为准',
    '- 未写入 `fixes/closes/resolves #...`，不会触发 GitHub Issue session 清理',
    '',
    '## 已批准方案',
    input.planBody.trim(),
    '',
    '## 交付信息',
    `- Commit: ${input.commitSha}`,
  ].join('\n');
}

export function writeTempBodyFile(body: string): string {
  const rand = Math.random().toString(HEX_RADIX).slice(HEX_SLICE_START);
  const filePath = path.join(
    os.tmpdir(),
    `along-task-pr-${Date.now()}-${rand}.md`,
  );
  fs.writeFileSync(filePath, body, 'utf-8');
  return filePath;
}

async function callGhCreate(
  runner: TaskDeliveryCommandRunner,
  worktreePath: string,
  repo: string,
  branchName: string,
  defaultBranch: string,
  title: string,
  bodyFile: string,
  ghToken: string,
): Promise<Result<string>> {
  return runner(
    'gh',
    [
      'pr',
      'create',
      '--repo',
      repo,
      '--head',
      branchName,
      '--base',
      defaultBranch,
      '--title',
      title,
      '--body-file',
      bodyFile,
    ],
    { cwd: worktreePath, env: { ...process.env, GH_TOKEN: ghToken } },
  );
}

type RepoTask = { repoOwner: string; repoName: string };

export async function createDeliveryPr(
  ctx: DeliveryContext,
  taskSnapshot: TaskPlanningSnapshot,
  worktreePath: string,
  branchName: string,
  defaultBranch: string,
  finalCommitSha: string,
  changedFiles: string[],
  approvedPlanBody: string,
): Promise<Result<{ prUrl: string; prNumber: number | undefined }>> {
  const { input, snapshot } = ctx;
  const runner = input.commandRunner || defaultTaskWorktreeCommandRunner;
  const tokenRes = await (input.readToken || readGhToken)();
  if (!tokenRes.success) return failDeliveryRun(ctx, tokenRes.error);
  const { repoOwner, repoName } = taskSnapshot.task as RepoTask;
  const body = buildPrBody({
    taskId: input.taskId,
    seq: snapshot.task.seq,
    planBody: approvedPlanBody,
    changedFiles,
    branchName,
    commitSha: finalCommitSha,
  });
  const bodyFile = writeTempBodyFile(body);
  try {
    const ghRes = await callGhCreate(
      runner,
      worktreePath,
      `${repoOwner}/${repoName}`,
      branchName,
      defaultBranch,
      buildPrTitle(snapshot.task.seq, snapshot.task.title),
      bodyFile,
      tokenRes.data,
    );
    if (!ghRes.success)
      return failDeliveryRun(ctx, `创建 PR 失败: ${ghRes.error}`);
    const prUrl = ghRes.data.trim();
    return success({ prUrl, prNumber: parsePrNumber(prUrl) });
  } finally {
    try {
      fs.unlinkSync(bodyFile);
    } catch {}
  }
}
