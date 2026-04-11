import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useScreenSize } from "fullscreen-ink";
import { Header } from "./Header";
import { SessionTable } from "./SessionTable";
import { LogPanel } from "./LogPanel";
import { StatusBar } from "./StatusBar";
import { SessionDetail } from "./SessionDetail";
import { TabBar, FILTERS, FilterType } from "./TabBar";
import { useSessions } from "./use-sessions";
import { useLogs } from "./use-logs";
import type { DashboardProps, DashboardSession } from "./types";

interface Props extends DashboardProps {
  startTime: number;
}

export function Dashboard({ port, host, startTime }: Props) {
  const app = useApp();
  const { height } = useScreenSize();
  const { sessions, counts } = useSessions();
  const logs = useLogs();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [currentFilter, setCurrentFilter] = useState<FilterType>("all");

  const filteredSessions = sessions.filter((s: DashboardSession) => {
    if (currentFilter === "all") return true;
    return s.status === currentFilter;
  });

  useInput((input, key) => {
    if (input === "q") {
      app.exit();
    }

    if (showDetail) {
      if (key.escape || input === "b") {
        setShowDetail(false);
      }
      return;
    }

    if (key.upArrow || input === "k") {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((prev) => Math.min(filteredSessions.length - 1, prev + 1));
    }
    if (key.leftArrow || input === "h") {
      const idx = FILTERS.indexOf(currentFilter);
      const newIdx = idx > 0 ? idx - 1 : FILTERS.length - 1;
      setCurrentFilter(FILTERS[newIdx]);
      setSelectedIndex(0);
    }
    if (key.rightArrow || input === "l") {
      const idx = FILTERS.indexOf(currentFilter);
      const newIdx = idx < FILTERS.length - 1 ? idx + 1 : 0;
      setCurrentFilter(FILTERS[newIdx]);
      setSelectedIndex(0);
    }
    if (key.return) {
      if (filteredSessions.length > 0) {
        setShowDetail(true);
      }
    }
  });

  // Layout: header(1) + separator(1) + table(flex) + separator(1) + logPanel(fixed) + separator(1) + statusBar(1) + hint(1)
  const fixedRows = 7; // header + tabBar + 3 separators + statusBar + hint
  const logPanelHeight = Math.min(8, Math.max(3, Math.floor(height * 0.25)));
  const contentHeight = Math.max(3, height - fixedRows - logPanelHeight);

  if (showDetail && filteredSessions[selectedIndex]) {
    return (
      <Box flexDirection="column" height={height}>
        <Header port={port} host={host} startTime={startTime} />
        <TabBar currentFilter={currentFilter} />
        <Box paddingX={1}>
          <Text dimColor>{"─".repeat(88)}</Text>
        </Box>
        <SessionDetail
          session={filteredSessions[selectedIndex]}
          height={contentHeight + logPanelHeight + 1}
          onBack={() => setShowDetail(false)}
        />
        <Box paddingX={1}>
          <Text dimColor>{"─".repeat(88)}</Text>
        </Box>
        <StatusBar counts={counts} />
        <Box paddingX={1}>
          <Text dimColor>按 Esc 或 b 返回 │ 按 q 退出</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={height}>
      <Header port={port} host={host} startTime={startTime} />
      <TabBar currentFilter={currentFilter} />
      <Box paddingX={1}>
        <Text dimColor>{"─".repeat(88)}</Text>
      </Box>

      <SessionTable
        sessions={filteredSessions}
        height={contentHeight}
        selectedIndex={selectedIndex}
      />

      <Box paddingX={1}>
        <Text dimColor>{"─".repeat(88)}</Text>
      </Box>

      <LogPanel logs={logs} height={logPanelHeight} />

      <Box paddingX={1}>
        <Text dimColor>{"─".repeat(88)}</Text>
      </Box>

      <StatusBar counts={counts} />

      <Box paddingX={1}>
        <Text dimColor>↑/↓/j/k 选择 │ ←/→/h/l 切换分类 │ Enter 详情 │ q 退出</Text>
      </Box>
    </Box>
  );
}
