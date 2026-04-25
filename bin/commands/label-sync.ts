#!/usr/bin/env bun
/**
 * label-sync.ts - 仓库 Label 同步命令
 *
 * 将代码中定义的 label 元数据同步到 GitHub 仓库，
 * 同时清理项目不使用的默认 label。
 */
import { get_gh_client } from "../integration/github-client";
import { syncLabels } from "../domain/label-sync";
import { consola } from "consola";

const logger = consola.withTag("label-sync");

async function main() {
  logger.info("开始同步仓库标签...");

  const clientRes = await get_gh_client();
  if (!clientRes.success) {
    logger.error(`获取 GitHub 客户端失败: ${clientRes.error}`);
    process.exit(1);
  }

  const res = await syncLabels(clientRes.data);
  if (!res.success) {
    logger.error(`同步失败: ${res.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error(`脚本执行异常: ${err.message}`);
  process.exit(1);
});
