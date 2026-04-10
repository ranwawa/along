import React from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useScreenSize } from "fullscreen-ink";
import { Header } from "./Header";
import { SessionTable } from "./SessionTable";
import { LogPanel } from "./LogPanel";
import { StatusBar } from "./StatusBar";
import { useSessions } from "./use-sessions";
import { useLogs } from "./use-logs";
import type { DashboardProps } from "./types";

interface Props extends DashboardProps {
  startTime: number;
}

export function Dashboard({ port, host, startTime }: Props) {
  const app = useApp();
  const { height } = useScreenSize();
  const { sessions, counts } = useSessions();
  const logs = useLogs();

  useInput((input) => {
    if (input === "q") {
      app.exit();
    }
  });

  // Layout: header(1) + separator(1) + table(flex) + separator(1) + logPanel(fixed) + separator(1) + statusBar(1) + hint(1)
  const fixedRows = 6; // header + 3 separators + statusBar + hint
  const logPanelHeight = Math.min(8, Math.max(3, Math.floor(height * 0.25)));
  const tableHeight = Math.max(3, height - fixedRows - logPanelHeight);

  return (
    <Box flexDirection="column" height={height}>
      <Header port={port} host={host} startTime={startTime} />
      <Box paddingX={1}>
        <Text dimColor>{"─".repeat(86)}</Text>
      </Box>

      <SessionTable sessions={sessions} height={tableHeight} />

      <Box paddingX={1}>
        <Text dimColor>{"─".repeat(86)}</Text>
      </Box>

      <LogPanel logs={logs} height={logPanelHeight} />

      <Box paddingX={1}>
        <Text dimColor>{"─".repeat(86)}</Text>
      </Box>

      <StatusBar counts={counts} />

      <Box paddingX={1}>
        <Text dimColor>按 q 退出 │ 每 3 秒自动刷新</Text>
      </Box>
    </Box>
  );
}
