import { useState, useEffect, useCallback } from "react";
import { getLogEntries, subscribeToLogs } from "./log-buffer";
import type { LogEntry } from "./types";

export function useLogs(): LogEntry[] {
  const [logs, setLogs] = useState<LogEntry[]>(() => [...getLogEntries()]);

  const refresh = useCallback(() => {
    setLogs([...getLogEntries()]);
  }, []);

  useEffect(() => {
    return subscribeToLogs(refresh);
  }, [refresh]);

  return logs;
}
