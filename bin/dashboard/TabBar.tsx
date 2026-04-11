import React from "react";
import { Box, Text } from "ink";

export const FILTERS = ["all", "running", "completed", "error", "crashed", "zombie"] as const;
export type FilterType = typeof FILTERS[number];

const FILTER_LABELS: Record<FilterType, string> = {
  all: "全部",
  running: "运行中",
  completed: "已完成",
  error: "错误",
  crashed: "崩溃",
  zombie: "僵尸",
};

interface TabBarProps {
  currentFilter: FilterType;
}

export function TabBar({ currentFilter }: TabBarProps) {
  return (
    <Box paddingX={1} flexDirection="row">
      <Text dimColor>分类: </Text>
      {FILTERS.map((f, i) => {
        const isSelected = f === currentFilter;
        return (
          <Box key={f} marginRight={2}>
            <Text
              color={isSelected ? "cyan" : undefined}
              dimColor={!isSelected}
              bold={isSelected}
            >
              {isSelected ? `[ ${FILTER_LABELS[f]} ]` : `  ${FILTER_LABELS[f]}  `}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
