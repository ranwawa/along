import { useEffect, useMemo, useState } from 'react';
import type { DashboardSession } from '../types';
import { countSessions, getIssueKey, type StatusFilter } from './sessionUtils';

function useSessionPolling() {
  const [sessions, setSessions] = useState<DashboardSession[]>([]);
  useEffect(() => {
    let active = true;
    const fetchSessions = async () => {
      try {
        const res = await fetch('/api/sessions');
        if (!res.ok) return;
        const data = (await res.json()) as DashboardSession[];
        data.sort((left, right) => right.issueNumber - left.issueNumber);
        if (active) setSessions(data);
      } catch (err) {
        console.error('Failed to fetch sessions', err);
      }
    };
    fetchSessions();
    const timer = setInterval(fetchSessions, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return { sessions, setSessions };
}

function useSessionFilters(sessions: DashboardSession[]) {
  const [currentFilter, setCurrentFilter] = useState<StatusFilter>('all');
  const [repoFilter, setRepoFilter] = useState('');
  const counts = useMemo(() => countSessions(sessions), [sessions]);
  const filteredSessions = useMemo(() => {
    return sessions.filter((session) => {
      const byStatus =
        currentFilter === 'all' || session.lifecycle === currentFilter;
      const byRepo =
        !repoFilter ||
        session.repo.toLowerCase().includes(repoFilter.toLowerCase());
      return byStatus && byRepo;
    });
  }, [sessions, currentFilter, repoFilter]);
  return {
    counts,
    currentFilter,
    setCurrentFilter,
    repoFilter,
    setRepoFilter,
    filteredSessions,
  };
}

function removeKey(
  setter: React.Dispatch<React.SetStateAction<Set<string>>>,
  key: string,
) {
  setter((prev) => {
    const next = new Set(prev);
    next.delete(key);
    return next;
  });
}

async function postSessionAction(path: string, session: DashboardSession) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner: session.owner,
      repo: session.repo,
      issueNumber: session.issueNumber,
    }),
  });
}

function useSessionBusySets() {
  const [restartingIssues, setRestartingIssues] = useState<Set<string>>(
    new Set(),
  );
  const [cleaningIssues, setCleaningIssues] = useState<Set<string>>(new Set());
  const [deletingIssues, setDeletingIssues] = useState<Set<string>>(new Set());
  return {
    restartingIssues,
    setRestartingIssues,
    cleaningIssues,
    setCleaningIssues,
    deletingIssues,
    setDeletingIssues,
  };
}

type SessionMutationInput = {
  busy: ReturnType<typeof useSessionBusySets>;
  setSessions: React.Dispatch<React.SetStateAction<DashboardSession[]>>;
  setSelectedSession: React.Dispatch<
    React.SetStateAction<DashboardSession | null>
  >;
};

function useRestartSession(input: SessionMutationInput) {
  const restartSession = async (
    session: DashboardSession,
    event?: React.MouseEvent,
  ) => {
    event?.stopPropagation();
    const key = getIssueKey(session);
    if (input.busy.restartingIssues.has(key)) return;
    input.busy.setRestartingIssues((prev) => new Set(prev).add(key));
    try {
      const res = await postSessionAction('/api/restart', session);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: '重启请求失败' }));
        alert(data.error || '重启请求失败');
      }
    } catch (err) {
      console.error('Restart request failed:', err);
    } finally {
      setTimeout(() => removeKey(input.busy.setRestartingIssues, key), 3000);
    }
  };
  return { restartSession };
}

function useCleanupWorktree(input: SessionMutationInput) {
  const cleanupWorktree = async (
    session: DashboardSession,
    event?: React.MouseEvent,
  ) => {
    event?.stopPropagation();
    const key = getIssueKey(session);
    if (input.busy.cleaningIssues.has(key)) return;
    input.busy.setCleaningIssues((prev) => new Set(prev).add(key));
    try {
      const res = await postSessionAction('/api/cleanup', session);
      if (res.ok) {
        input.setSessions((prev) =>
          prev.map((item) =>
            getIssueKey(item) === key ? { ...item, hasWorktree: false } : item,
          ),
        );
        input.setSelectedSession(null);
      }
    } finally {
      removeKey(input.busy.setCleaningIssues, key);
    }
  };
  return { cleanupWorktree };
}

function useDeleteSessionAssets(input: SessionMutationInput) {
  const deleteSessionAssets = async (
    session: DashboardSession,
    event?: React.MouseEvent,
  ) => {
    event?.stopPropagation();
    const key = getIssueKey(session);
    if (input.busy.deletingIssues.has(key) || !confirmDelete(key)) return;
    input.busy.setDeletingIssues((prev) => new Set(prev).add(key));
    try {
      const res = await postSessionAction('/api/delete', session);
      if (res.ok) {
        input.setSessions((prev) =>
          prev.filter((item) => getIssueKey(item) !== key),
        );
        input.setSelectedSession((current) =>
          current && getIssueKey(current) === key ? null : current,
        );
      }
    } finally {
      removeKey(input.busy.setDeletingIssues, key);
    }
  };
  return { deleteSessionAssets };
}

function useSessionMutations(input: SessionMutationInput) {
  return {
    ...useRestartSession(input),
    ...useCleanupWorktree(input),
    ...useDeleteSessionAssets(input),
  };
}

function confirmDelete(key: string) {
  return window.confirm(
    `删除 ${key} 的所有本地数据？\n\n这会移除 SQLite 记录、日志、issue 目录、worktree、本地分支，以及其他和这个 issue 相关的本机数据。`,
  );
}

export function useDashboardSessions() {
  const { sessions, setSessions } = useSessionPolling();
  const filters = useSessionFilters(sessions);
  const [selectedSession, setSelectedSession] =
    useState<DashboardSession | null>(null);
  const busy = useSessionBusySets();
  const mutations = useSessionMutations({
    busy,
    setSessions,
    setSelectedSession,
  });
  return {
    ...filters,
    selectedSession,
    setSelectedSession,
    ...busy,
    ...mutations,
  };
}
