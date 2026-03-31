#!/usr/bin/env bun
/**
 * watch.ts - ALONG 任务进度实时监控
 * 自动刷新显示任务状态看板
 */
import { $ } from "bun";
import path from "path";
import { config } from "./config";

const REFRESH_INTERVAL = 2000; // 2秒刷新一次

async function clearScreen() {
  console.clear();
}

async function showStatus() {
  const statusScript = path.join(config.BIN_DIR, "status.ts");
  try {
    const proc = Bun.spawn(["bun", statusScript], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const error = await new Response(proc.stderr).text();
    if (error) console.error(error);
    console.log(output);
  } catch (e) {
    console.error("获取状态失败:", e);
  }
}

async function watchLoop() {
  while (true) {
    await clearScreen();
    console.log("🔄 ALONG 任务实时监控 (按 Ctrl+C 退出)");
    console.log("");
    await showStatus();
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
