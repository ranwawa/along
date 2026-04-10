import React from "react";
import { Box, Text } from "ink";
import type { StatusCounts } from "./types";

interface StatusBarProps {
  counts: StatusCounts;
}

export function StatusBar({ counts }: StatusBarProps) {
  return (
    <Box paddingX={1}>
      <Text color="yellow" bold>
        运行中: {counts.running}
      </Text>
      <Text> │ </Text>
      <Text color="green" bold>
        已完成: {counts.completed}
      </Text>
      <Text> │ </Text>
      <Text color="red" bold>
        错误: {counts.error}
      </Text>
      <Text> │ </Text>
      <Text color="red">崩溃: {counts.crashed}</Text>
      {counts.zombie > 0 && (
        <>
          <Text> │ </Text>
          <Text color="magenta">僵尸: {counts.zombie}</Text>
        </>
      )}
      <Text> │ </Text>
      <Text>总计: {counts.total}</Text>
    </Box>
  );
}
