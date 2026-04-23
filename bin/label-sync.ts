#!/usr/bin/env bun
/**
 * label-sync.ts - 仓库 Label 同步脚本
 *
 * 将代码中定义的 label 元数据同步到 GitHub 仓库，
 * 同时清理项目不使用的默认 label。
 */
import { get_gh_client } from "./github-client";
import { consola } from "consola";

const logger = consola.withTag("label-sync");

// === Label 元数据定义（唯一真实来源）===

interface LabelMeta {
  name: string;
  color: string;
  description: string;
}

/**
 * Lifecycle 类 label（蓝色系）
 */
const LIFECYCLE_LABELS_META: LabelMeta[] = [
  { name: "running", color: "1E90FF", description: "Session 正在运行中" },
  { name: "waiting_human", color: "4169E1", description: "等待人工介入" },
  { name: "waiting_external", color: "6495ED", description: "等待外部依赖（PR 审核、CI 等）" },
  { name: "completed", color: "228B22", description: "Session 已完成" },
  { name: "failed", color: "DC143C", description: "Session 执行失败" },
  { name: "interrupted", color: "FF8C00", description: "Session 被中断" },
];

/**
 * Triage 类 label（红/绿/黄/灰色系）
 */
const TRIAGE_LABELS_META: LabelMeta[] = [
  { name: "bug", color: "D73A4A", description: "缺陷/回归/异常行为，需要代码修复" },
  { name: "enhancement", color: "A2EEEF", description: "新功能/增强/重构/文档改进" },
  { name: "question", color: "D876E3", description: "提问/求助/咨询，不需要代码修改" },
  { name: "spam", color: "6A737D", description: "广告/无意义/测试内容" },
];

/**
 * Phase 类 label（紫色系）
 */
const PHASE_LABELS_META: LabelMeta[] = [
  { name: "planning", color: "8B5CF6", description: "规划阶段" },
  { name: "implementation", color: "7C3AED", description: "实施阶段" },
  { name: "delivery", color: "6D28D9", description: "交付阶段" },
  { name: "stabilization", color: "5B21B6", description: "稳定化阶段（审核、CI）" },
  { name: "done", color: "4C1D95", description: "已完成" },
];

/**
 * 辅助类 label
 */
const AUX_LABELS_META: LabelMeta[] = [
  { name: "invalid", color: "B60205", description: "无效 Issue（被 blocking 的标签）" },
];

/**
 * 需要清理的 GitHub 默认 label
 */
const DEFAULT_LABELS_TO_DELETE = [
  "duplicate",
  "good first issue",
  "help wanted",
  "wontfix",
  "documentation",
  "invalid",
];

// 合并所有定义的 label
const ALL_DEFINED_LABELS = [
  ...LIFECYCLE_LABELS_META,
  ...TRIAGE_LABELS_META,
  ...PHASE_LABELS_META,
  ...AUX_LABELS_META,
];

async function main() {
  logger.info("开始同步仓库标签...");

  // 获取 GitHub 客户端
  const clientRes = await get_gh_client();
  if (!clientRes.success) {
    logger.error(`获取 GitHub 客户端失败: ${clientRes.error}`);
    process.exit(1);
  }
  const client = clientRes.data;

  // 获取仓库当前所有 label
  const labelsRes = await client.listLabels();
  if (!labelsRes.success) {
    logger.error(`获取仓库标签列表失败: ${labelsRes.error}`);
    process.exit(1);
  }
  const currentLabels = labelsRes.data;

  logger.info(`仓库当前共 ${currentLabels.length} 个标签`);

  const definedLabelNames = new Set(ALL_DEFINED_LABELS.map((l) => l.name));

  // === 1. 创建或更新定义的 label ===
  const toCreate: LabelMeta[] = [];
  const toUpdate: LabelMeta[] = [];

  for (const meta of ALL_DEFINED_LABELS) {
    const existing = currentLabels.find((l) => l.name === meta.name);
    if (!existing) {
      toCreate.push(meta);
    } else {
      // 颜色或描述不一致需要更新
      if (existing.color !== meta.color || existing.description !== meta.description) {
        toUpdate.push(meta);
      }
    }
  }

  // === 2. 删除仓库中存在但代码未定义的 label ===
  const toDelete = currentLabels
    .filter((l) => !definedLabelNames.has(l.name) && DEFAULT_LABELS_TO_DELETE.includes(l.name))
    .map((l) => l.name);

  // === 执行同步 ===

  let created = 0;
  let updated = 0;
  let deleted = 0;

  // 创建缺失的 label
  for (const meta of toCreate) {
    const res = await client.createLabel(meta.name, meta.color, meta.description);
    if (res.success) {
      logger.success(`✓ 创建标签: ${meta.name}`);
      created++;
    } else {
      logger.error(`✗ 创建标签失败: ${meta.name} - ${res.error}`);
    }
  }

  // 更新不一致的 label
  for (const meta of toUpdate) {
    const res = await client.updateLabel(meta.name, meta.color, meta.description);
    if (res.success) {
      logger.success(`✓ 更新标签: ${meta.name}`);
      updated++;
    } else {
      logger.error(`✗ 更新标签失败: ${meta.name} - ${res.error}`);
    }
  }

  // 删除不需要的 default label
  for (const name of toDelete) {
    const res = await client.deleteLabel(name);
    if (res.success) {
      logger.success(`✓ 删除标签: ${name}`);
      deleted++;
    } else {
      logger.error(`✗ 删除标签失败: ${name} - ${res.error}`);
    }
  }

  // === 输出汇总 ===
  logger.info("=".repeat(50));
  logger.info("同步完成:");
  logger.info(`  新建: ${created}`);
  logger.info(`  更新: ${updated}`);
  logger.info(`  删除: ${deleted}`);
  logger.info(`  保留: ${currentLabels.length - deleted + (toCreate.length + toUpdate.length) - deleted}`);

  // 验证结果
  const finalRes = await client.listLabels();
  if (finalRes.success) {
    const finalCount = finalRes.data.length;
    const expectedCount = ALL_DEFINED_LABELS.length;
    if (finalCount === expectedCount) {
      logger.success(`✓ 标签数量验证通过: ${finalCount}/${expectedCount}`);
    } else {
      logger.warn(`⚠ 标签数量不匹配: 实际 ${finalCount}，期望 ${expectedCount}`);
    }
  }
}

main().catch((err) => {
  logger.error(`脚本执行异常: ${err.message}`);
  process.exit(1);
});