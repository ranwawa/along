import React from "react";
import { Box, Text } from "ink";
import type { DashboardSession } from "./types";

interface SessionTableProps {
  sessions: DashboardSession[];
  height: number;
  selectedIndex: number;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  running: { label: "运行中", color: "yellow" },
  completed: { label: "已完成", color: "green" },
  error: { label: "错误", color: "red" },
  crashed: { label: "崩溃", color: "red" },
  zombie: { label: "僵尸", color: "magenta" },
};

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 2) + "..";
}

function padRight(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len);
  return str + " ".repeat(len - str.length);
}

export function SessionTable({ sessions, height, selectedIndex }: SessionTableProps) {
  // Reserve 1 row for header, 1 for separator
  const maxRows = Math.max(0, height - 2);
  const visibleSessions = sessions.slice(0, maxRows);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Header */}
      <Box paddingX={1}>
        <Text bold dimColor>
          {padRight(" ", 2)}
          {padRight("#", 4)}
          {padRight("仓库", 22)}
          {padRight("Issue", 8)}
          {padRight("标题", 20)}
          {padRight("状态", 8)}
          {padRight("步骤", 16)}
          {padRight("耗时", 8)}
        </Text>
      </Box>
      <Box paddingX={1}>
        <Text dimColor>{"─".repeat(88)}</Text>
      </Box>

      {/* Rows */}
      {visibleSessions.map((s, i) => {
        const isSelected = i === selectedIndex;
        const statusInfo = STATUS_MAP[s.status] || { label: s.status, color: "white" };
        const repoStr = `${s.owner}/${s.repo}`;
        return (
          <Box key={`${s.owner}/${s.repo}/${s.issueNumber}`} paddingX={1}>
            <Text color="cyan">{isSelected ? "→ " : "  "}</Text>
            <Text dimColor={!isSelected} bold={isSelected}>{padRight(String(i + 1), 4)}</Text>
            <Text bold={isSelected}>{padRight(truncate(repoStr, 20), 22)}</Text>
            <Text bold>
              {padRight(`#${s.issueNumber}`, 8)}
            </Text>
            <Text bold={isSelected}>{padRight(truncate(s.title, 18), 20)}</Text>
            <Text color={statusInfo.color as any} bold={isSelected}>
              {padRight(statusInfo.label, 8)}
            </Text>
            <Text dimColor={!isSelected} bold={isSelected}>{padRight(truncate(s.currentStep, 14), 16)}</Text>
            <Text bold={isSelected}>{padRight(s.runtime, 8)}</Text>
          </Box>
        );
      })}

      {sessions.length === 0 && (
        <Box paddingX={1} justifyContent="center">
          <Text dimColor>暂无任务</Text>
        </Box>
      )}

      {sessions.length > maxRows && (
        <Box paddingX={1}>
          <Text dimColor>... 还有 {sessions.length - maxRows} 个任务未显示</Text>
        </Box>
      )}
    </Box>
  );
}
