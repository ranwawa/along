import React from "react";
import { Box, Text } from "ink";
import type { LogEntry } from "./types";

interface LogPanelProps {
  logs: LogEntry[];
  height: number;
}

const LEVEL_COLORS: Record<string, string> = {
  info: "cyan",
  success: "green",
  warn: "yellow",
  error: "red",
  debug: "gray",
};

function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function LogPanel({ logs, height }: LogPanelProps) {
  const visibleLogs = logs.slice(-height);

  return (
    <Box flexDirection="column" height={height}>
      <Box paddingX={1}>
        <Text bold dimColor>
          日志
        </Text>
      </Box>
      {visibleLogs.map((log, i) => {
        const color = LEVEL_COLORS[log.level] || "white";
        const tag = log.tag ? `[${log.tag}] ` : "";
        return (
          <Box key={i} paddingX={1}>
            <Text dimColor>[{formatTime(log.timestamp)}] </Text>
            <Text color={color as any}>
              {tag}
              {log.message}
            </Text>
          </Box>
        );
      })}
      {visibleLogs.length === 0 && (
        <Box paddingX={1}>
          <Text dimColor>暂无日志</Text>
        </Box>
      )}
    </Box>
  );
}
