import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { DashboardSession } from "./types";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { analyzeErrorLog } from "../analyze-error";

interface SessionDetailProps {
  session: DashboardSession;
  onBack: () => void;
  height: number;
}

function readLastBytes(filePath: string, bytes: number): string {
  if (!fs.existsSync(filePath)) return "";
  const stats = fs.statSync(filePath);
  const size = stats.size;
  const start = Math.max(0, size - bytes);
  const length = size - start;
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(filePath, "r");
  fs.readSync(fd, buffer, 0, length, start);
  fs.closeSync(fd);
  return buffer.toString("utf-8");
}

export function SessionDetail({ session, onBack, height }: SessionDetailProps) {
  const absoluteLogDir = path.join(os.homedir(), ".along", session.owner, session.repo, String(session.issueNumber));
  const agentLogPath = path.join(absoluteLogDir, "agent.log");
  const fallbackTmuxLogPath = path.join(absoluteLogDir, "tmux.log");
  const activeLogPath = fs.existsSync(agentLogPath) ? agentLogPath : fallbackTmuxLogPath;
  const logDir = `~/.along/${session.owner}/${session.repo}/${session.issueNumber}`;
  
  const [analyzing, setAnalyzing] = useState(false);
  const [aiReport, setAiReport] = useState<string | null>(null);

  useInput((input) => {
    if (input === 'v') {
      if (fs.existsSync(activeLogPath)) {
        // 使用 less 打开完整日志，+G 表示默认跳到最后
        spawnSync("less", ["-R", "+G", activeLogPath], { stdio: "inherit" });
      }
    }
    if (input === 'a' && !analyzing && !aiReport) {
      if (fs.existsSync(activeLogPath)) {
        setAnalyzing(true);
        const logContent = readLastBytes(activeLogPath, 16000); // 读最后大概16KB作分析
        analyzeErrorLog(logContent).then((report) => {
          setAiReport(report);
          setAnalyzing(false);
        }).catch((err) => {
          setAiReport(`分析失败: ${err.message}`);
          setAnalyzing(false);
        });
      } else {
        setAiReport("未找到日志文件 (agent.log 或 tmux.log)，无法分析。");
      }
    }
  });

  return (
    <Box flexDirection="column" height={height} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold inverted color="cyan"> {session.title} (#{session.issueNumber}) </Text>
        <Text dimColor>  [Esc/b] 返回 │ [v] less查看完整日志 │ [a] AI自动分析</Text>
      </Box>

      {/* Meta Info */}
      <Box flexDirection="row" marginBottom={1}>
        <Box flexDirection="column" width={40}>
          <Text>仓库: <Text color="cyan">{session.owner}/{session.repo}</Text></Text>
          <Text>状态: <StatusText status={session.status} /></Text>
          <Text>耗时: {session.runtime}</Text>
          {session.pid && <Text>进程 PID: {session.pid}</Text>}
        </Box>
        <Box flexDirection="column">
          <Text>标题: {session.title}</Text>
          <Text>分支: {session.branchName || "N/A"}</Text>
          {session.prUrl && <Text>PR: <Text color="blue" underline>{session.prUrl}</Text></Text>}
        </Box>
      </Box>

      {/* Step Info */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>当前步骤: <Text color="yellow">{session.currentStep || "无"}</Text></Text>
        <Text dimColor>最新消息: {session.lastMessage || "无"}</Text>
      </Box>

      {/* AI Analysis Report */}
      {analyzing && (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
          <Text color="cyan" bold>🧠 AI 正在分析日志，请稍候...</Text>
        </Box>
      )}

      {aiReport && (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
          <Text color="cyan" bold>🧠 AI 分析结果:</Text>
          <Text>{aiReport}</Text>
        </Box>
      )}

      {/* Basic Error Info */}
      {!aiReport && !analyzing && (session.errorMessage || session.crashLog) && (
        <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1} marginBottom={1}>
          <Text color="red" bold>错误信息:</Text>
          <Text>{session.errorMessage || "未知错误"}</Text>
          {session.crashLog && (
            <>
              <Text dimColor>────── 崩溃日志片段 (最后 20 行) ──────</Text>
              <Text color="gray">{session.crashLog}</Text>
            </>
          )}
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text bold color="gray">相关文件:</Text>
        <Text dimColor> 📂 目录: {logDir}</Text>
        <Text dimColor> 📝 系统: {logDir}/system.log</Text>
        <Text dimColor> 🤖 代理: {logDir}/agent.log</Text>
      </Box>
    </Box>
  );
}

function StatusText({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "yellow",
    completed: "green",
    error: "red",
    crashed: "red",
    zombie: "magenta",
  };
  const labels: Record<string, string> = {
    running: "运行中",
    completed: "已完成",
    error: "错误",
    crashed: "崩溃",
    zombie: "僵尸",
  };
  return <Text color={colors[status] || "white"}>{labels[status] || status}</Text>;
}
