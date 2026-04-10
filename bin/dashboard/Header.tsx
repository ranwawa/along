import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

interface HeaderProps {
  port: number;
  host: string;
  startTime: number;
}

function formatUptime(startTime: number): string {
  const diff = Math.floor((Date.now() - startTime) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m${diff % 60}s`;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return `${h}h${m}m`;
}

export function Header({ port, host, startTime }: HeaderProps) {
  const [uptime, setUptime] = useState(formatUptime(startTime));

  useEffect(() => {
    const timer = setInterval(() => {
      setUptime(formatUptime(startTime));
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  return (
    <Box paddingX={1}>
      <Text bold color="cyan">
        ALONG 任务大盘
      </Text>
      <Text> │ </Text>
      <Text>
        端口: <Text bold>{port}</Text>
      </Text>
      <Text> │ </Text>
      <Text>
        运行: <Text bold>{uptime}</Text>
      </Text>
      <Text> │ </Text>
      <Text color="green" bold>
        ● 在线
      </Text>
    </Box>
  );
}
