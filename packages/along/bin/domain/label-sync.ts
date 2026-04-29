import { consola } from 'consola';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import type { GitHubClient } from '../integration/github-client';

const logger = consola.withTag('label-sync');

// === Label 元数据定义（唯一真实来源）===

export interface LabelMeta {
  name: string;
  color: string;
  description: string;
}

/**
 * Lifecycle 类 label（蓝色系）
 */
export const LIFECYCLE_LABELS_META: LabelMeta[] = [
  { name: 'running', color: '1E90FF', description: 'Session 正在运行中' },
  { name: 'waiting_human', color: '4169E1', description: '等待人工介入' },
  {
    name: 'waiting_external',
    color: '6495ED',
    description: '等待外部依赖（PR 审核、CI 等）',
  },
  { name: 'completed', color: '228B22', description: 'Session 已完成' },
  { name: 'failed', color: 'DC143C', description: 'Session 执行失败' },
  { name: 'interrupted', color: 'FF8C00', description: 'Session 被中断' },
];

/**
 * Triage 类 label（红/绿/黄/灰色系）
 */
export const TRIAGE_LABELS_META: LabelMeta[] = [
  {
    name: 'bug',
    color: 'D73A4A',
    description: '缺陷/回归/异常行为，需要代码修复',
  },
  {
    name: 'feature',
    color: 'A2EEEF',
    description: '新功能/增强/重构/文档改进',
  },
  {
    name: 'question',
    color: 'D876E3',
    description: '提问/求助/咨询，不需要代码修改',
  },
  { name: 'spam', color: '6A737D', description: '广告/无意义/测试内容' },
];

/**
 * Phase 类 label（紫色系）
 */
export const PHASE_LABELS_META: LabelMeta[] = [
  { name: 'planning', color: '8B5CF6', description: '规划阶段' },
  { name: 'implementation', color: '7C3AED', description: '实施阶段' },
  { name: 'delivery', color: '6D28D9', description: '交付阶段' },
  {
    name: 'stabilization',
    color: '5B21B6',
    description: '稳定化阶段（审核、CI）',
  },
  { name: 'done', color: '4C1D95', description: '已完成' },
];

/**
 * 需要清理的 GitHub 默认 label
 */
export const DEFAULT_LABELS_TO_DELETE = [
  'duplicate',
  'good first issue',
  'help wanted',
  'wontfix',
  'documentation',
  'invalid',
  'WIP',
  'approved',
  'enhancement',
];

/**
 * 合并所有定义的 label
 */
export const ALL_DEFINED_LABELS = [
  ...LIFECYCLE_LABELS_META,
  ...TRIAGE_LABELS_META,
  ...PHASE_LABELS_META,
];

// === 内存级缓存：记录已同步的 owner/repo ===
const syncedRepos = new Set<string>();

function getRepoKey(client: GitHubClient): string {
  return client.owner + '/' + client.repo;
}

/**
 * 幂等地确保所有定义的 label 存在于目标仓库
 * - 只创建缺失的
 * - 更新颜色/描述不一致的
 * - 不删除默认 label
 * - 同一进程内对同一仓库只执行一次 API 调用
 */
export async function ensureLabelsExist(
  client: GitHubClient,
): Promise<Result<void>> {
  const repoKey = getRepoKey(client);
  if (syncedRepos.has(repoKey)) {
    logger.debug(`Label 已同步，跳过: ${repoKey}`);
    return success(undefined);
  }

  const labelsRes = await client.listLabels();
  if (!labelsRes.success) {
    return failure(`获取仓库标签列表失败: ${labelsRes.error}`);
  }
  const currentLabels = labelsRes.data;

  const toCreate: LabelMeta[] = [];
  const toUpdate: LabelMeta[] = [];

  for (const meta of ALL_DEFINED_LABELS) {
    const existing = currentLabels.find((l) => l.name === meta.name);
    if (!existing) {
      toCreate.push(meta);
    } else if (
      existing.color !== meta.color ||
      existing.description !== meta.description
    ) {
      toUpdate.push(meta);
    }
  }

  for (const meta of toCreate) {
    const res = await client.createLabel(
      meta.name,
      meta.color,
      meta.description,
    );
    if (!res.success) {
      logger.error(`创建标签失败: ${meta.name} - ${res.error}`);
    } else {
      logger.success(`✓ 创建标签: ${meta.name}`);
    }
  }

  for (const meta of toUpdate) {
    const res = await client.updateLabel(
      meta.name,
      meta.color,
      meta.description,
    );
    if (!res.success) {
      logger.error(`更新标签失败: ${meta.name} - ${res.error}`);
    } else {
      logger.success(`✓ 更新标签: ${meta.name}`);
    }
  }

  syncedRepos.add(repoKey);
  logger.info(
    `Label 同步完成: ${repoKey}（新建 ${toCreate.length}，更新 ${toUpdate.length}）`,
  );
  return success(undefined);
}

/**
 * 完整同步（创建 + 更新 + 删除默认 label）
 * 供 CLI `along label-sync` 显式调用
 */
export async function syncLabels(client: GitHubClient): Promise<Result<void>> {
  const labelsRes = await client.listLabels();
  if (!labelsRes.success) {
    return failure(`获取仓库标签列表失败: ${labelsRes.error}`);
  }
  const currentLabels = labelsRes.data;

  logger.info(`仓库当前共 ${currentLabels.length} 个标签`);

  const definedLabelNames = new Set(ALL_DEFINED_LABELS.map((l) => l.name));

  const toCreate: LabelMeta[] = [];
  const toUpdate: LabelMeta[] = [];

  for (const meta of ALL_DEFINED_LABELS) {
    const existing = currentLabels.find((l) => l.name === meta.name);
    if (!existing) {
      toCreate.push(meta);
    } else if (
      existing.color !== meta.color ||
      existing.description !== meta.description
    ) {
      toUpdate.push(meta);
    }
  }

  const toDelete = currentLabels
    .filter(
      (l) =>
        !definedLabelNames.has(l.name) &&
        DEFAULT_LABELS_TO_DELETE.includes(l.name),
    )
    .map((l) => l.name);

  let created = 0;
  let updated = 0;
  let deleted = 0;

  for (const meta of toCreate) {
    const res = await client.createLabel(
      meta.name,
      meta.color,
      meta.description,
    );
    if (res.success) {
      logger.success(`✓ 创建标签: ${meta.name}`);
      created++;
    } else {
      logger.error(`✗ 创建标签失败: ${meta.name} - ${res.error}`);
    }
  }

  for (const meta of toUpdate) {
    const res = await client.updateLabel(
      meta.name,
      meta.color,
      meta.description,
    );
    if (res.success) {
      logger.success(`✓ 更新标签: ${meta.name}`);
      updated++;
    } else {
      logger.error(`✗ 更新标签失败: ${meta.name} - ${res.error}`);
    }
  }

  for (const name of toDelete) {
    const res = await client.deleteLabel(name);
    if (res.success) {
      logger.success(`✓ 删除标签: ${name}`);
      deleted++;
    } else {
      logger.error(`✗ 删除标签失败: ${name} - ${res.error}`);
    }
  }

  logger.info('='.repeat(50));
  logger.info('同步完成:');
  logger.info(`  新建: ${created}`);
  logger.info(`  更新: ${updated}`);
  logger.info(`  删除: ${deleted}`);
  logger.info(
    `  保留: ${currentLabels.length - deleted + (toCreate.length + toUpdate.length) - deleted}`,
  );

  const finalRes = await client.listLabels();
  if (finalRes.success) {
    const finalCount = finalRes.data.length;
    const expectedCount = ALL_DEFINED_LABELS.length;
    if (finalCount === expectedCount) {
      logger.success(`✓ 标签数量验证通过: ${finalCount}/${expectedCount}`);
    } else {
      logger.warn(
        `⚠ 标签数量不匹配: 实际 ${finalCount}，期望 ${expectedCount}`,
      );
    }
  }

  return success(undefined);
}
