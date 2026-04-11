import { useState, useEffect } from "react";
import { findAllSessions, readSession } from "../db";
import { calculate_runtime, check_process_running } from "../common";
import type { DashboardSession, StatusCounts } from "./types";

const POLL_INTERVAL = 3000;

const STATUS_PRIORITY: Record<string, number> = {
  running: 0,
  zombie: 1,
  crashed: 2,
  error: 3,
  completed: 4,
};

export function useSessions(): { sessions: DashboardSession[]; counts: StatusCounts } {
  const [sessions, setSessions] = useState<DashboardSession[]>([]);
  const [counts, setCounts] = useState<StatusCounts>({
    running: 0,
    completed: 0,
    error: 0,
    crashed: 0,
    zombie: 0,
    total: 0,
  });

  useEffect(() => {
    let active = true;

    async function poll() {
      if (!active) return;

      const allSessions = findAllSessions();
      const results: DashboardSession[] = [];

      for (const info of allSessions) {
        const status = readSession(info.owner, info.repo, info.issueNumber);
        if (!status) continue;

        let displayStatus = status.status as DashboardSession["status"];
        if (status.status === "running" && status.pid) {
          const alive = await check_process_running(status.pid);
          if (!alive) displayStatus = "zombie";
        }

        results.push({
          owner: info.owner,
          repo: info.repo,
          issueNumber: status.issueNumber,
          title: status.title || `Issue #${status.issueNumber}`,
          status: displayStatus,
          currentStep: status.currentStep || "",
          lastMessage: status.lastMessage || "",
          startTime: status.startTime,
          endTime: status.endTime,
          runtime: calculate_runtime(status.startTime),
          pid: status.pid,
          prUrl: status.prUrl,
          branchName: status.branchName || "",
           agentType: status.agentType,
          retryCount: status.retryCount,
          errorMessage: status.errorMessage,
          crashLog: status.crashLog,
        });
      }

      results.sort((a, b) => {
        const pa = STATUS_PRIORITY[a.status] ?? 99;
        const pb = STATUS_PRIORITY[b.status] ?? 99;
        if (pa !== pb) return pa - pb;
        return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
      });

      const newCounts: StatusCounts = {
        running: 0,
        completed: 0,
        error: 0,
        crashed: 0,
        zombie: 0,
        total: results.length,
      };
      for (const s of results) {
        if (s.status in newCounts) {
          (newCounts as any)[s.status]++;
        }
      }

      if (active) {
        setSessions(results);
        setCounts(newCounts);
      }
    }

    poll();
    const timer = setInterval(poll, POLL_INTERVAL);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return { sessions, counts };
}
