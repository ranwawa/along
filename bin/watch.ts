#!/usr/bin/env bun
/**
 * watch.ts - ALONG 任务进度实时监控
 * 自动刷新显示任务状态看板
 */
import { printStatusBoard } from "./status";

const REFRESH_INTERVAL = 2000; // 2秒刷新一次

async function watchLoop() {
  while (true) {
    console.clear();
    console.log("🔄 ALONG 任务实时监控 (按 Ctrl+C 退出)");
    console.log("");
    await printStatusBoard();
    console.log("");
    console.log(`下次刷新: ${REFRESH_INTERVAL / 1000}秒后...`);
    await Bun.sleep(REFRESH_INTERVAL);
  }
}

async function main() {
  console.log("启动 ALONG 任务实时监控...");
  console.log("");

  try {
    await watchLoop();
  } catch (e) {
    if (e instanceof Error && e.name === "Interrupt") {
      console.log("\n");
      console.log("监控已停止");
    } else {
      throw e;
    }
  }
}

main();
