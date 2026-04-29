import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConversationFileInfo,
  ConversationMessage,
  DashboardSession,
  SessionDiagnostic,
  StatusCounts,
  UnifiedLogEntry,
} from './types';
import './index.css';

const statusFilters = [
  'all',
  'running',
  'waiting_human',
  'waiting_external',
  'completed',
  'failed',
  'interrupted',
  'zombie',
] as const;

function App() {
  const [sessions, setSessions] = useState<DashboardSession[]>([]);
  const [currentFilter, setCurrentFilter] = useState<string>('all');
  const [selectedSession, setSelectedSession] =
    useState<DashboardSession | null>(null);
  const [selectedLogTab, setSelectedLogTab] = useState<
    'timeline' | 'lifecycle' | 'conversation' | 'diagnostic'
  >('timeline');
  const [sessionLogs, setSessionLogs] = useState<UnifiedLogEntry[]>([]);
  const [selectedDiagnostic, setSelectedDiagnostic] =
    useState<SessionDiagnostic | null>(null);
  const [selectedLogsLoading, setSelectedLogsLoading] = useState(false);
  const sseRef = useRef<EventSource | null>(null);
  const [restartingIssues, setRestartingIssues] = useState<Set<string>>(
    new Set(),
  );
  const [cleaningIssues, setCleaningIssues] = useState<Set<string>>(new Set());
  const [deletingIssues, setDeletingIssues] = useState<Set<string>>(new Set());
  const [repoFilter, setRepoFilter] = useState<string>('');
  const [conversationFiles, setConversationFiles] = useState<
    ConversationFileInfo[]
  >([]);
  const [activeConvFile, setActiveConvFile] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<
    ConversationMessage[]
  >([]);
  const [convLoading, setConvLoading] = useState(false);
  const convSseRef = useRef<EventSource | null>(null);
  const userSelectedConvFile = useRef(false);
  const activeConvFileRef = useRef<string | null>(null);

  // Poll sessions
  useEffect(() => {
    let active = true;
    const fetchSessions = async () => {
      try {
        const res = await fetch('/api/sessions');
        if (!res.ok) return;
        const data = await res.json();
        if (active) {
          // Sort by issue number descending
          data.sort(
            (a: DashboardSession, b: DashboardSession) =>
              b.issueNumber - a.issueNumber,
          );
          setSessions(data);
        }
      } catch (e) {
        console.error('Failed to fetch sessions', e);
      }
    };

    fetchSessions();
    const timer = setInterval(fetchSessions, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedSession) {
      setSessionLogs([]);
      setSelectedDiagnostic(null);
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      return;
    }

    let active = true;
    setSelectedLogTab('timeline');
    setSelectedLogsLoading(true);

    const params = new URLSearchParams({
      owner: selectedSession.owner,
      repo: selectedSession.repo,
      issueNumber: String(selectedSession.issueNumber),
    });

    const loadInitial = async () => {
      try {
        const [logsRes, diagnosticRes] = await Promise.all([
          fetch(`/api/logs/session?${params.toString()}&maxLines=500`),
          fetch(`/api/logs/diagnostic?${params.toString()}`),
        ]);

        if (!active) return;

        if (logsRes.ok) {
          setSessionLogs(await logsRes.json());
        } else {
          setSessionLogs([]);
        }

        if (diagnosticRes.ok) {
          setSelectedDiagnostic(await diagnosticRes.json());
        } else {
          setSelectedDiagnostic(null);
        }
      } catch {
        if (!active) return;
        setSessionLogs([]);
        setSelectedDiagnostic(null);
      } finally {
        if (active) {
          setSelectedLogsLoading(false);
        }
      }
    };

    loadInitial();

    // SSE for real-time log updates
    const sse = new EventSource(
      `/api/logs/session/stream?${params.toString()}`,
    );
    sseRef.current = sse;
    sse.onmessage = (event) => {
      if (!active) return;
      try {
        const entry: UnifiedLogEntry = JSON.parse(event.data);
        setSessionLogs((prev) => [...prev, entry]);
      } catch {}
    };
    sse.onerror = () => {
      // SSE will auto-reconnect; no action needed
    };

    return () => {
      active = false;
      sse.close();
      sseRef.current = null;
    };
  }, [selectedSession]);

  // Load conversation files when conversation tab is selected
  useEffect(() => {
    if (!selectedSession || selectedLogTab !== 'conversation') {
      setConversationFiles([]);
      setActiveConvFile(null);
      activeConvFileRef.current = null;
      setConversationMessages([]);
      userSelectedConvFile.current = false;
      return;
    }

    const params = new URLSearchParams({
      owner: selectedSession.owner,
      repo: selectedSession.repo,
      issueNumber: String(selectedSession.issueNumber),
    });

    const loadFiles = async () => {
      try {
        const res = await fetch(
          `/api/logs/conversation/files?${params.toString()}`,
        );
        if (res.ok) {
          const files: ConversationFileInfo[] = await res.json();
          setConversationFiles(files);
          if (files.length > 0) {
            if (userSelectedConvFile.current) {
              const stillExists = files.some(
                (f) => f.filename === activeConvFileRef.current,
              );
              if (!stillExists) {
                const latest = files[files.length - 1].filename;
                setActiveConvFile(latest);
                activeConvFileRef.current = latest;
              }
            } else {
              const latest = files[files.length - 1].filename;
              setActiveConvFile(latest);
              activeConvFileRef.current = latest;
            }
          }
        }
      } catch {}
    };

    loadFiles();
    const pollId = setInterval(loadFiles, 5000);
    return () => clearInterval(pollId);
  }, [selectedSession, selectedLogTab]);

  // Load conversation messages when active file changes
  useEffect(() => {
    if (convSseRef.current) {
      convSseRef.current.close();
      convSseRef.current = null;
    }

    if (!selectedSession || !activeConvFile) {
      setConversationMessages([]);
      return;
    }

    let active = true;
    setConvLoading(true);

    const params = new URLSearchParams({
      owner: selectedSession.owner,
      repo: selectedSession.repo,
      issueNumber: String(selectedSession.issueNumber),
      file: activeConvFile,
    });

    const loadMessages = async () => {
      try {
        const res = await fetch(`/api/logs/conversation?${params.toString()}`);
        if (!active) return;
        if (res.ok) {
          setConversationMessages(await res.json());
        } else {
          setConversationMessages([]);
        }
      } catch {
        if (active) setConversationMessages([]);
      } finally {
        if (active) setConvLoading(false);
      }
    };

    loadMessages();

    const sse = new EventSource(
      `/api/logs/conversation/stream?${params.toString()}`,
    );
    convSseRef.current = sse;
    sse.onmessage = (event) => {
      if (!active) return;
      try {
        const entries = JSON.parse(event.data);
        if (Array.isArray(entries)) {
          setConversationMessages((prev) => [...prev, ...entries]);
        }
      } catch {}
    };

    return () => {
      active = false;
      sse.close();
      convSseRef.current = null;
    };
  }, [selectedSession, activeConvFile]);

  const counts = useMemo<StatusCounts>(() => {
    const defaultCounts: StatusCounts = {
      running: 0,
      waiting_human: 0,
      waiting_external: 0,
      completed: 0,
      failed: 0,
      interrupted: 0,
      zombie: 0,
      total: sessions.length,
    };
    for (const s of sessions) {
      defaultCounts[s.lifecycle] += 1;
    }
    return defaultCounts;
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      const matchesStatus =
        currentFilter === 'all' || s.lifecycle === currentFilter;
      const matchesRepo =
        !repoFilter || s.repo.toLowerCase().includes(repoFilter.toLowerCase());
      return matchesStatus && matchesRepo;
    });
  }, [sessions, currentFilter, repoFilter]);

  const isFailedStatus = (lifecycle: string) =>
    ['failed', 'interrupted', 'zombie'].includes(lifecycle);
  const getIssueKey = (session: DashboardSession) =>
    `${session.owner}/${session.repo}#${session.issueNumber}`;
  const getFilterCount = (filter: (typeof statusFilters)[number]) =>
    filter === 'all' ? counts.total : counts[filter];

  const getLifecycleLabel = (lifecycle: string) => {
    switch (lifecycle) {
      case 'running':
        return 'Running';
      case 'waiting_human':
        return 'Waiting Human';
      case 'waiting_external':
        return 'Waiting External';
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
      case 'interrupted':
        return 'Interrupted';
      case 'zombie':
        return 'Zombie';
      default:
        return lifecycle;
    }
  };

  const getPhaseLabel = (phase?: string) => {
    switch (phase) {
      case 'planning':
        return 'Planning';
      case 'implementation':
        return 'Implementation';
      case 'delivery':
        return 'Delivery';
      case 'stabilization':
        return 'Stabilization';
      case 'done':
        return 'Done';
      default:
        return phase || 'Unknown';
    }
  };

  const getStepLabel = (step?: string) => {
    if (!step) return 'Unknown';
    return step
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  };

  const getProgressLabel = (session: DashboardSession) => {
    if (!session.progress?.total) return null;
    return `${session.progress.current ?? 0}/${session.progress.total} ${session.progress.unit || ''}`.trim();
  };

  const getBranchName = (session: DashboardSession) =>
    session.context?.branchName || '-';

  const getStatusColor = (lifecycle: string) => {
    switch (lifecycle) {
      case 'running':
        return 'bg-sky-500/15 text-status-running border-sky-500/30';
      case 'waiting_human':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'waiting_external':
        return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
      case 'completed':
        return 'bg-emerald-500/15 text-status-completed border-emerald-500/30';
      case 'failed':
        return 'bg-red-500/15 text-status-error border-red-500/30';
      case 'interrupted':
        return 'bg-orange-500/15 text-status-crashed border-orange-500/30';
      case 'zombie':
        return 'bg-purple-500/15 text-status-zombie border-purple-500/30';
      default:
        return 'bg-gray-500/15 text-gray-300 border-gray-500/30';
    }
  };

  const restartSession = async (
    session: DashboardSession,
    e?: React.MouseEvent,
  ) => {
    if (e) e.stopPropagation();
    const key = getIssueKey(session);
    if (restartingIssues.has(key)) return;

    setRestartingIssues((prev) => new Set(prev).add(key));
    try {
      const res = await fetch('/api/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: session.owner,
          repo: session.repo,
          issueNumber: session.issueNumber,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: '重启请求失败' }));
        alert(data.error || '重启请求失败');
        console.error('Restart failed:', data.error);
      }
    } catch (e) {
      console.error('Restart request failed:', e);
    } finally {
      // Keep spinner for a bit, then clear
      setTimeout(() => {
        setRestartingIssues((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, 3000);
    }
  };

  const cleanupWorktree = async (
    session: DashboardSession,
    e?: React.MouseEvent,
  ) => {
    if (e) e.stopPropagation();
    const key = getIssueKey(session);
    if (cleaningIssues.has(key)) return;

    setCleaningIssues((prev) => new Set(prev).add(key));
    try {
      const res = await fetch('/api/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: session.owner,
          repo: session.repo,
          issueNumber: session.issueNumber,
        }),
      });
      if (res.ok) {
        setSessions((prev) =>
          prev.map((s) =>
            s.owner === session.owner &&
            s.repo === session.repo &&
            s.issueNumber === session.issueNumber
              ? { ...s, hasWorktree: false }
              : s,
          ),
        );
        setSelectedSession(null);
      } else {
        const data = await res.json();
        console.error('Cleanup failed:', data.error);
      }
    } catch (e) {
      console.error('Cleanup request failed:', e);
    } finally {
      setCleaningIssues((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const deleteSessionAssets = async (
    session: DashboardSession,
    e?: React.MouseEvent,
  ) => {
    if (e) e.stopPropagation();
    const key = getIssueKey(session);
    if (deletingIssues.has(key)) return;

    const confirmed = window.confirm(
      `删除 ${key} 的所有本地数据？\n\n这会移除 SQLite 记录、日志、issue 目录、worktree、本地分支，以及其他和这个 issue 相关的本机数据。`,
    );
    if (!confirmed) return;

    setDeletingIssues((prev) => new Set(prev).add(key));
    try {
      const res = await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: session.owner,
          repo: session.repo,
          issueNumber: session.issueNumber,
        }),
      });
      if (res.ok) {
        setSessions((prev) =>
          prev.filter(
            (s) =>
              !(
                s.owner === session.owner &&
                s.repo === session.repo &&
                s.issueNumber === session.issueNumber
              ),
          ),
        );
        setSelectedSession((current) =>
          current &&
          current.owner === session.owner &&
          current.repo === session.repo &&
          current.issueNumber === session.issueNumber
            ? null
            : current,
        );
      } else {
        const data = await res.json();
        console.error('Delete failed:', data.error);
      }
    } catch (err) {
      console.error('Delete request failed:', err);
    } finally {
      setDeletingIssues((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const getLogLevelColor = (level: string) => {
    if (level === 'info') return 'text-status-running';
    if (level === 'error') return 'text-status-error';
    if (level === 'warn') return 'text-status-crashed';
    if (level === 'success') return 'text-status-completed';
    return '';
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'lifecycle':
        return 'text-sky-300';
      case 'conversation':
        return 'text-amber-300';
      case 'diagnostic':
        return 'text-red-300';
      case 'webhook':
        return 'text-purple-300';
      case 'server':
        return 'text-emerald-300';
      default:
        return 'text-text-muted';
    }
  };

  const filteredLogs = useMemo(() => {
    if (selectedLogTab === 'timeline') return sessionLogs;
    if (selectedLogTab === 'lifecycle')
      return sessionLogs.filter((e) => e.category === 'lifecycle');
    if (selectedLogTab === 'diagnostic')
      return sessionLogs.filter((e) => e.category === 'diagnostic');
    return sessionLogs;
  }, [sessionLogs, selectedLogTab]);

  const renderConversationMessage = (msg: ConversationMessage, i: number) => {
    if (msg.type === 'assistant') {
      const texts = (msg.message?.content || [])
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text);
      if (texts.length === 0) return null;
      return (
        <div
          key={`conv-${i}`}
          className="p-2 rounded bg-blue-500/10 border border-blue-500/20 whitespace-pre-wrap break-all"
        >
          <span className="text-blue-300 font-semibold text-xs mr-2">
            [assistant]
          </span>
          <span>{texts.join('\n')}</span>
        </div>
      );
    }
    if (msg.type === 'user') {
      const texts = (msg.message?.content || [])
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text);
      return (
        <div
          key={`conv-${i}`}
          className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 whitespace-pre-wrap break-all"
        >
          <span className="text-emerald-300 font-semibold text-xs mr-2">
            [user]
          </span>
          <span>
            {texts.join('\n') || JSON.stringify(msg.message?.content)}
          </span>
        </div>
      );
    }
    if (msg.type === 'result') {
      const cost =
        typeof msg.total_cost_usd === 'number'
          ? `$${msg.total_cost_usd.toFixed(4)}`
          : '';
      const turns = msg.num_turns || '';
      return (
        <div
          key={`conv-${i}`}
          className="p-2 rounded bg-amber-500/10 border border-amber-500/20"
        >
          <span className="text-amber-300 font-semibold text-xs mr-2">
            [result]
          </span>
          <span>
            {msg.subtype || 'done'} {turns ? `(${turns} turns` : ''}
            {cost ? `, ${cost})` : turns ? ')' : ''}
          </span>
        </div>
      );
    }
    if (msg.type === 'tool_use_summary') {
      return (
        <div
          key={`conv-${i}`}
          className="p-2 rounded bg-purple-500/10 border border-purple-500/20"
        >
          <span className="text-purple-300 font-semibold text-xs mr-2">
            [tool]
          </span>
          <span className="text-gray-300">{msg.tool_name || 'unknown'}</span>
          {msg.tool_input && (
            <span className="text-text-muted ml-2 text-xs">
              {String(msg.tool_input).slice(0, 200)}
            </span>
          )}
        </div>
      );
    }
    return (
      <div
        key={`conv-${i}`}
        className="p-1.5 rounded bg-white/5 text-text-muted text-xs"
      >
        <span className="font-semibold mr-2">
          [{msg.type}
          {msg.subtype ? `:${msg.subtype}` : ''}]
        </span>
        <span>{JSON.stringify(msg).slice(0, 300)}</span>
      </div>
    );
  };

  const renderConversationTab = () => {
    if (conversationFiles.length === 0 && !convLoading) {
      return (
        <div className="p-4 text-text-muted">No conversation logs yet.</div>
      );
    }

    return (
      <div className="flex flex-col h-full gap-2">
        {conversationFiles.length > 1 && (
          <div className="flex gap-1.5 flex-wrap shrink-0">
            {conversationFiles.map((f) => (
              <button
                key={f.filename}
                className={`px-2 py-1 rounded text-xs border transition-all cursor-pointer ${
                  activeConvFile === f.filename
                    ? 'bg-white/10 text-white border-border-color'
                    : 'bg-transparent text-text-secondary border-transparent hover:bg-white/5'
                }`}
                onClick={() => {
                  userSelectedConvFile.current = true;
                  activeConvFileRef.current = f.filename;
                  setActiveConvFile(f.filename);
                }}
              >
                {f.phase}/{f.workflow}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-1.5">
          {convLoading ? (
            <div className="p-4 text-text-muted">Loading conversation...</div>
          ) : conversationMessages.length === 0 ? (
            <div className="p-4 text-text-muted">No messages in this file.</div>
          ) : (
            conversationMessages.map((msg, i) =>
              renderConversationMessage(msg, i),
            )
          )}
        </div>
      </div>
    );
  };

  const renderUnifiedLogEntries = (entries: UnifiedLogEntry[]) => {
    if (entries.length === 0) {
      return <div className="p-4 text-text-muted">No logs yet.</div>;
    }

    return entries.map((entry, i) => (
      <div
        key={`log-${i}`}
        className="p-1.5 rounded break-all hover:bg-white/5 whitespace-pre-wrap"
      >
        <span className="text-text-muted mr-2">
          {new Intl.DateTimeFormat('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }).format(new Date(entry.timestamp))}
        </span>
        <span
          className={`font-semibold mr-2 uppercase ${getLogLevelColor(entry.level)}`}
        >
          [{entry.level}]
        </span>
        {selectedLogTab === 'timeline' && (
          <span
            className={`font-semibold mr-2 ${getCategoryColor(entry.category)}`}
          >
            [{entry.category}]
          </span>
        )}
        <span className="text-text-muted mr-2">({entry.source})</span>
        <span>{entry.message}</span>
      </div>
    ));
  };

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden">
      <header className="flex flex-col gap-3 md:flex-row md:justify-between md:items-center px-4 py-4 md:px-6 md:py-5 border-b border-border-color shrink-0">
        <h1 className="font-semibold text-xl md:text-2xl tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
          🚀 ALONG Dashboard
        </h1>
        <div className="flex flex-wrap gap-1.5 md:gap-2">
          {statusFilters.map((filter) => (
            <button
              key={filter}
              className={`px-2.5 py-1 md:px-3 md:py-1.5 rounded-md cursor-pointer text-xs md:text-sm transition-all border ${
                currentFilter === filter
                  ? 'bg-white/10 text-white border-border-color'
                  : 'bg-transparent border-transparent text-text-secondary hover:bg-white/5'
              }`}
              onClick={() => setCurrentFilter(filter)}
            >
              {filter === 'all' ? 'All' : getLifecycleLabel(filter)}
              {filter !== 'all' && (
                <span className="opacity-60 ml-1.5">
                  {getFilterCount(filter)}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 min-h-0 px-0 md:px-0">
        <div className="h-full bg-bg-glass backdrop-blur-md border-x-0 md:border-x-0 border-y-0 md:border-y-0 border border-border-color rounded-none flex flex-col overflow-hidden min-h-[300px]">
          <div className="px-4 py-3 md:px-6 md:py-5 border-b border-border-color font-semibold text-sm md:text-base flex justify-between items-center">
            <span>Recent Tasks</span>
            <div className="relative">
              <input
                type="text"
                placeholder="Filter by repo..."
                value={repoFilter}
                onChange={(e) => setRepoFilter(e.target.value)}
                className="bg-white/5 border border-border-color rounded-lg px-3 py-1 text-xs md:text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/50 w-32 md:w-48 transition-all"
              />
              {repoFilter && (
                <button
                  onClick={() => setRepoFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-white bg-transparent border-none cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {/* Mobile card list */}
            <div className="lg:hidden flex flex-col">
              {filteredSessions.length === 0 ? (
                <div className="text-center text-text-muted px-4 py-8">
                  No tasks found.
                </div>
              ) : null}
              {filteredSessions.map((session) => (
                <div
                  key={`m-${session.owner}-${session.repo}-${session.issueNumber}`}
                  onClick={() => setSelectedSession(session)}
                  className="flex items-center gap-3 px-4 py-3 border-b border-white/5 cursor-pointer hover:bg-white/5 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-text-secondary text-sm">
                        {session.owner}/{session.repo}
                      </span>
                      <span className="text-sm">
                        <a
                          href={`https://github.com/${session.owner}/${session.repo}/issues/${session.issueNumber}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-inherit hover:underline"
                        >
                          #{session.issueNumber}
                        </a>
                        {session.context?.prNumber &&
                          session.context?.prUrl && (
                            <a
                              href={session.context.prUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="ml-1 text-inherit hover:underline"
                            >
                              PR #{session.context.prNumber}
                            </a>
                          )}
                        {session.hasWorktree && (
                          <span
                            className="ml-1 opacity-70"
                            title="Worktree exists"
                          >
                            📁
                          </span>
                        )}
                      </span>
                    </div>
                    {session.title && (
                      <div className="text-sm truncate mb-1">
                        {session.title}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize border ${getStatusColor(session.lifecycle)}`}
                      >
                        {getLifecycleLabel(session.lifecycle)}
                      </span>
                      <span className="text-text-muted text-xs truncate">
                        {getPhaseLabel(session.phase)} /{' '}
                        {getStepLabel(session.step)}
                      </span>
                      {getProgressLabel(session) && (
                        <span className="text-text-muted text-xs truncate">
                          {getProgressLabel(session)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    className="flex gap-1.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isFailedStatus(session.lifecycle) && (
                      <button
                        className={`inline-flex items-center justify-center w-7 h-7 rounded-lg border border-transparent transition-all cursor-pointer ${
                          restartingIssues.has(getIssueKey(session))
                            ? 'bg-blue-500/20 text-status-running animate-spin'
                            : 'bg-white/5 text-text-secondary hover:bg-blue-500/20 hover:text-status-running'
                        }`}
                        title="重启此任务"
                        onClick={(e) => restartSession(session, e)}
                        disabled={restartingIssues.has(getIssueKey(session))}
                      >
                        🔄
                      </button>
                    )}
                    <button
                      className={`inline-flex items-center justify-center w-7 h-7 rounded-lg border border-transparent transition-all cursor-pointer ${
                        deletingIssues.has(getIssueKey(session))
                          ? 'bg-red-500/20 text-red-400 cursor-wait'
                          : 'bg-white/5 text-text-secondary hover:bg-red-500/20 hover:text-red-300'
                      }`}
                      title="彻底删除此任务的本地数据"
                      onClick={(e) => deleteSessionAssets(session, e)}
                      disabled={deletingIssues.has(getIssueKey(session))}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <table className="hidden lg:table w-full border-collapse text-left">
              <thead>
                <tr>
                  <th className="sticky top-0 bg-bg-secondary px-6 py-4 text-sm font-medium text-text-secondary border-b border-border-color z-10">
                    Issue
                  </th>
                  <th className="sticky top-0 bg-bg-secondary px-6 py-4 text-sm font-medium text-text-secondary border-b border-border-color z-10">
                    Title
                  </th>
                  <th className="sticky top-0 bg-bg-secondary px-6 py-4 text-sm font-medium text-text-secondary border-b border-border-color z-10">
                    Status
                  </th>
                  <th className="sticky top-0 bg-bg-secondary px-6 py-4 text-sm font-medium text-text-secondary border-b border-border-color z-10 w-16">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="text-center text-text-muted px-6 py-4"
                    >
                      No tasks found.
                    </td>
                  </tr>
                ) : null}
                {filteredSessions.map((session) => (
                  <tr
                    key={`${session.owner}-${session.repo}-${session.issueNumber}`}
                    onClick={() => setSelectedSession(session)}
                    className="transition-colors cursor-pointer hover:bg-white/5"
                  >
                    <td className="px-6 py-4 border-b border-white/5 text-sm">
                      <span className="text-text-secondary">
                        {session.owner}/{session.repo}
                      </span>
                      <a
                        href={`https://github.com/${session.owner}/${session.repo}/issues/${session.issueNumber}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="ml-2 text-inherit hover:underline"
                      >
                        #{session.issueNumber}
                      </a>
                      {session.context?.prNumber && session.context?.prUrl && (
                        <a
                          href={session.context.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="ml-2 text-inherit hover:underline"
                        >
                          PR #{session.context.prNumber}
                        </a>
                      )}
                      {session.hasWorktree && (
                        <span
                          className="ml-2 opacity-70"
                          title="Worktree exists"
                        >
                          📁
                        </span>
                      )}
                    </td>
                    <td
                      className="px-6 py-4 border-b border-white/5 text-sm max-w-[300px] whitespace-nowrap overflow-hidden text-ellipsis"
                      title={session.title || ''}
                    >
                      {session.title || '-'}
                    </td>
                    <td className="px-6 py-4 border-b border-white/5 text-sm">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold capitalize border ${getStatusColor(session.lifecycle)}`}
                      >
                        {getLifecycleLabel(session.lifecycle)}
                      </span>
                      <span className="ml-2 text-text-muted text-xs">
                        {getPhaseLabel(session.phase)} /{' '}
                        {getStepLabel(session.step)}
                      </span>
                    </td>
                    <td
                      className="px-6 py-4 border-b border-white/5 text-sm flex gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isFailedStatus(session.lifecycle) && (
                        <button
                          className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border border-transparent transition-all cursor-pointer ${
                            restartingIssues.has(getIssueKey(session))
                              ? 'bg-blue-500/20 text-status-running animate-spin'
                              : 'bg-white/5 text-text-secondary hover:bg-blue-500/20 hover:text-status-running hover:border-blue-500/30'
                          }`}
                          title="重启此任务"
                          onClick={(e) => restartSession(session, e)}
                          disabled={restartingIssues.has(getIssueKey(session))}
                        >
                          🔄
                        </button>
                      )}
                      <button
                        className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border border-transparent transition-all cursor-pointer ${
                          deletingIssues.has(getIssueKey(session))
                            ? 'bg-red-500/20 text-red-400 cursor-wait'
                            : 'bg-white/5 text-text-secondary hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/30'
                        }`}
                        title="彻底删除此任务的本地数据"
                        onClick={(e) => deleteSessionAssets(session, e)}
                        disabled={deletingIssues.has(getIssueKey(session))}
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selectedSession && (
        <div
          className="fixed inset-0 bg-black/45 backdrop-blur-[2px] z-50 animate-[fadeIn_0.2s_ease]"
          onClick={() => setSelectedSession(null)}
        >
          <div
            className="absolute inset-y-0 right-0 bg-bg-secondary border-l border-border-color w-full md:w-[88vw] xl:w-[82vw] max-w-[1280px] flex flex-col shadow-2xl animate-[slideInRight_0.28s_cubic-bezier(0.16,1,0.3,1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 md:p-6 border-b border-border-color flex justify-between items-center shrink-0">
              <h2 className="text-base md:text-xl font-bold truncate mr-2">
                {selectedSession.owner}/{selectedSession.repo}{' '}
                <a
                  href={`https://github.com/${selectedSession.owner}/${selectedSession.repo}/issues/${selectedSession.issueNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-inherit hover:underline"
                >
                  #{selectedSession.issueNumber}
                </a>
                {selectedSession.hasWorktree && (
                  <span className="ml-2 opacity-70" title="Worktree exists">
                    📁
                  </span>
                )}
              </h2>
              <button
                className="bg-transparent border-none text-text-secondary cursor-pointer p-2 rounded-lg transition-colors hover:bg-white/10 hover:text-white shrink-0"
                onClick={() => setSelectedSession(null)}
              >
                ✕
              </button>
            </div>
            <div className="flex-1 min-h-0 p-4 md:p-6">
              <div className="h-full min-h-0 flex flex-col gap-4 md:gap-6 lg:grid lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] lg:gap-6">
                <div className="min-h-0 lg:overflow-y-auto flex flex-col gap-4 md:gap-6 pr-0 lg:pr-3">
                  {selectedDiagnostic &&
                    isFailedStatus(selectedSession.lifecycle) && (
                      <div className="flex flex-col gap-3">
                        <div className="text-text-secondary font-medium text-xs md:text-sm">
                          Failure Summary
                        </div>
                        <div className="bg-black border border-border-color rounded-lg p-3 md:p-4 flex flex-col gap-3">
                          <div>
                            <div className="text-sm md:text-base font-semibold text-white">
                              {selectedDiagnostic.summary}
                            </div>
                            <div className="text-xs text-text-muted mt-1">
                              {selectedDiagnostic.category}
                              {selectedDiagnostic.phase
                                ? ` · ${selectedDiagnostic.phase}`
                                : ''}
                              {typeof selectedDiagnostic.exitCode === 'number'
                                ? ` · exit ${selectedDiagnostic.exitCode}`
                                : ''}
                            </div>
                          </div>
                          {selectedDiagnostic.command && (
                            <div className="font-mono text-xs md:text-[13px] text-gray-300 whitespace-pre-wrap break-all">
                              {selectedDiagnostic.command}
                            </div>
                          )}
                          {selectedDiagnostic.hints.length > 0 && (
                            <div className="flex flex-col gap-1">
                              {selectedDiagnostic.hints.map((hint, index) => (
                                <div
                                  key={index}
                                  className="text-xs md:text-sm text-gray-300"
                                >
                                  {index + 1}. {hint}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                  <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-baseline md:gap-4">
                    <span className="text-text-secondary font-medium text-xs md:text-sm">
                      Title
                    </span>
                    <span className="text-sm md:text-base">
                      {selectedSession.title}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-baseline md:gap-4">
                    <span className="text-text-secondary font-medium text-xs md:text-sm">
                      Status
                    </span>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold capitalize border ${getStatusColor(selectedSession.lifecycle)}`}
                      >
                        {getLifecycleLabel(selectedSession.lifecycle)}
                      </span>
                      {isFailedStatus(selectedSession.lifecycle) && (
                        <button
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                            restartingIssues.has(getIssueKey(selectedSession))
                              ? 'bg-blue-500/20 text-status-running border-blue-500/30 cursor-wait'
                              : 'bg-blue-500/10 text-status-running border-blue-500/30 hover:bg-blue-500/25'
                          }`}
                          onClick={() => restartSession(selectedSession)}
                          disabled={restartingIssues.has(
                            getIssueKey(selectedSession),
                          )}
                        >
                          🔄{' '}
                          {restartingIssues.has(getIssueKey(selectedSession))
                            ? '重启中...'
                            : '重启'}
                        </button>
                      )}
                      <button
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                          deletingIssues.has(getIssueKey(selectedSession))
                            ? 'bg-red-500/20 text-red-400 border-red-500/30 cursor-wait'
                            : 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/25'
                        }`}
                        onClick={() => deleteSessionAssets(selectedSession)}
                        disabled={deletingIssues.has(
                          getIssueKey(selectedSession),
                        )}
                      >
                        🗑️{' '}
                        {deletingIssues.has(getIssueKey(selectedSession))
                          ? '删除中...'
                          : '彻底删除'}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-baseline md:gap-4">
                    <span className="text-text-secondary font-medium text-xs md:text-sm">
                      Runtime
                    </span>
                    <span className="text-sm md:text-base">
                      {selectedSession.runtime}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-baseline md:gap-4">
                    <span className="text-text-secondary font-medium text-xs md:text-sm">
                      Current Step
                    </span>
                    <span className="text-sm md:text-base">
                      {getStepLabel(selectedSession.step)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-baseline md:gap-4">
                    <span className="text-text-secondary font-medium text-xs md:text-sm">
                      Phase
                    </span>
                    <span className="text-sm md:text-base">
                      {getPhaseLabel(selectedSession.phase)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-baseline md:gap-4">
                    <span className="text-text-secondary font-medium text-xs md:text-sm">
                      Message
                    </span>
                    <span className="text-sm md:text-base">
                      {selectedSession.message || 'N/A'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-baseline md:gap-4">
                    <span className="text-text-secondary font-medium text-xs md:text-sm">
                      Branch
                    </span>
                    <span className="text-sm md:text-base">
                      {getBranchName(selectedSession)}
                    </span>
                  </div>

                  {selectedSession.context?.prNumber &&
                    selectedSession.context?.prUrl && (
                      <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-baseline md:gap-4">
                        <span className="text-text-secondary font-medium text-xs md:text-sm">
                          Pull Request
                        </span>
                        <a
                          href={selectedSession.context.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm md:text-base text-inherit hover:underline"
                        >
                          PR #{selectedSession.context.prNumber}
                        </a>
                      </div>
                    )}

                  {selectedSession.hasWorktree && (
                    <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-baseline md:gap-4">
                      <span className="text-text-secondary font-medium text-xs md:text-sm">
                        Worktree
                      </span>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm md:text-base opacity-70">
                          📁 存在
                        </span>
                        <button
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                            cleaningIssues.has(getIssueKey(selectedSession))
                              ? 'bg-red-500/20 text-red-400 border-red-500/30 cursor-wait'
                              : 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/25'
                          }`}
                          onClick={(e) => cleanupWorktree(selectedSession, e)}
                          disabled={cleaningIssues.has(
                            getIssueKey(selectedSession),
                          )}
                        >
                          🗑️{' '}
                          {cleaningIssues.has(getIssueKey(selectedSession))
                            ? '清理中...'
                            : '删除 Worktree'}
                        </button>
                      </div>
                    </div>
                  )}

                  {selectedSession.error?.message && (
                    <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-start md:gap-4">
                      <span className="text-text-secondary font-medium text-xs md:text-sm">
                        Error
                      </span>
                      <div className="bg-black border border-border-color rounded-lg p-3 md:p-4 font-mono text-xs md:text-[13px] whitespace-pre-wrap text-status-error overflow-x-auto">
                        {selectedSession.error.message}
                      </div>
                    </div>
                  )}

                  {selectedSession.error?.details && (
                    <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-start md:gap-4">
                      <span className="text-text-secondary font-medium text-xs md:text-sm">
                        Crash Log
                      </span>
                      <div className="bg-black border border-border-color rounded-lg p-3 md:p-4 font-mono text-xs md:text-[13px] whitespace-pre-wrap text-white overflow-x-auto">
                        {selectedSession.error.details}
                      </div>
                    </div>
                  )}
                </div>

                <div className="min-h-[320px] lg:min-h-0 lg:h-full flex flex-col gap-3 border-t border-white/5 pt-4 lg:pt-0 lg:border-t-0 lg:border-l lg:border-white/5 lg:pl-6">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="text-text-secondary font-medium text-xs md:text-sm">
                        Session Logs
                      </div>
                      <div className="text-text-muted text-xs mt-1">
                        Timeline 保持默认打开，便于直接排障。
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {(
                        [
                          'timeline',
                          'lifecycle',
                          'conversation',
                          'diagnostic',
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                            selectedLogTab === tab
                              ? 'bg-white/10 text-white border-border-color'
                              : 'bg-transparent text-text-secondary border-border-color hover:bg-white/5'
                          }`}
                          onClick={() => setSelectedLogTab(tab)}
                        >
                          {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="bg-black border border-border-color rounded-lg p-3 md:p-4 font-mono text-xs md:text-[13px] text-gray-300 overflow-auto flex-1 min-h-0 flex flex-col gap-1.5">
                    {selectedLogTab === 'conversation' ? (
                      renderConversationTab()
                    ) : selectedLogsLoading ? (
                      <div className="p-4 text-text-muted">Loading logs...</div>
                    ) : (
                      renderUnifiedLogEntries(filteredLogs)
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
