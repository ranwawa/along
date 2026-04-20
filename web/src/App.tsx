import { useState, useEffect, useMemo } from 'react';
import type { SessionDiagnostic, SessionLogEntry, DashboardSession, StatusCounts } from './types';
import './index.css';

const statusFilters = [
  'all',
  'phase1_running',
  'awaiting_approval',
  'phase2_running',
  'awaiting_pr',
  'pr_open',
  'review_fixing',
  'ci_fixing',
  'merged',
  'error',
  'crashed',
  'zombie',
] as const;

function App() {
  const [sessions, setSessions] = useState<DashboardSession[]>([]);
  const [currentFilter, setCurrentFilter] = useState<string>('all');
  const [selectedSession, setSelectedSession] = useState<DashboardSession | null>(null);
  const [selectedLogTab, setSelectedLogTab] = useState<'system' | 'agent' | 'merged'>('merged');
  const [selectedSystemLogs, setSelectedSystemLogs] = useState<SessionLogEntry[]>([]);
  const [selectedAgentLogs, setSelectedAgentLogs] = useState<SessionLogEntry[]>([]);
  const [selectedMergedLogs, setSelectedMergedLogs] = useState<SessionLogEntry[]>([]);
  const [selectedDiagnostic, setSelectedDiagnostic] = useState<SessionDiagnostic | null>(null);
  const [selectedLogsLoading, setSelectedLogsLoading] = useState(false);
  const [restartingIssues, setRestartingIssues] = useState<Set<string>>(new Set());
  const [cleaningIssues, setCleaningIssues] = useState<Set<string>>(new Set());
  const [repoFilter, setRepoFilter] = useState<string>('');

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
          data.sort((a: DashboardSession, b: DashboardSession) => b.issueNumber - a.issueNumber);
          setSessions(data);
        }
      } catch (e) {
        console.error("Failed to fetch sessions", e);
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
      setSelectedSystemLogs([]);
      setSelectedAgentLogs([]);
      setSelectedMergedLogs([]);
      setSelectedDiagnostic(null);
      return;
    }

    let active = true;
    setSelectedLogTab('merged');
    setSelectedLogsLoading(true);

    const params = new URLSearchParams({
      owner: selectedSession.owner,
      repo: selectedSession.repo,
      issueNumber: String(selectedSession.issueNumber),
    });

    const loadDetails = async () => {
      try {
        const [systemRes, agentRes, mergedRes, diagnosticRes] = await Promise.all([
          fetch(`/api/session-log?${params.toString()}&source=system&maxLines=150`),
          fetch(`/api/session-log?${params.toString()}&source=agent&maxLines=250`),
          fetch(`/api/session-log?${params.toString()}&source=merged&maxLines=250`),
          fetch(`/api/session-diagnostic?${params.toString()}`),
        ]);

        if (!active) return;

        if (systemRes.ok) {
          setSelectedSystemLogs(await systemRes.json());
        } else {
          setSelectedSystemLogs([]);
        }

        if (agentRes.ok) {
          setSelectedAgentLogs(await agentRes.json());
        } else {
          setSelectedAgentLogs([]);
        }

        if (mergedRes.ok) {
          setSelectedMergedLogs(await mergedRes.json());
        } else {
          setSelectedMergedLogs([]);
        }

        if (diagnosticRes.ok) {
          setSelectedDiagnostic(await diagnosticRes.json());
        } else {
          setSelectedDiagnostic(null);
        }
      } catch (e) {
        if (!active) return;
        setSelectedSystemLogs([]);
        setSelectedAgentLogs([]);
        setSelectedMergedLogs([]);
        setSelectedDiagnostic(null);
      } finally {
        if (active) {
          setSelectedLogsLoading(false);
        }
      }
    };

    loadDetails();
    const timer = setInterval(loadDetails, 3000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedSession]);

  const counts = useMemo<StatusCounts>(() => {
    const defaultCounts: StatusCounts = {
      phase1_running: 0,
      awaiting_approval: 0,
      phase2_running: 0,
      awaiting_pr: 0,
      pr_open: 0,
      review_fixing: 0,
      ci_fixing: 0,
      merged: 0,
      error: 0,
      crashed: 0,
      zombie: 0,
      total: sessions.length,
    };
    for (const s of sessions) {
      if (s.status in defaultCounts) {
        (defaultCounts as any)[s.status]++;
      }
    }
    return defaultCounts;
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    return sessions.filter(s => {
      const matchesStatus = currentFilter === 'all' || s.status === currentFilter;
      const matchesRepo = !repoFilter || s.repo.toLowerCase().includes(repoFilter.toLowerCase());
      return matchesStatus && matchesRepo;
    });
  }, [sessions, currentFilter, repoFilter]);

  const isFailedStatus = (status: string) => ['error', 'crashed', 'zombie'].includes(status);

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'phase1_running': return 'Phase 1';
      case 'awaiting_approval': return 'Awaiting Approval';
      case 'phase2_running': return 'Phase 2';
      case 'awaiting_pr': return 'Awaiting PR';
      case 'pr_open': return 'PR Open';
      case 'review_fixing': return 'Review Fix';
      case 'ci_fixing': return 'CI Fix';
      case 'merged': return 'Merged';
      case 'error': return 'Error';
      case 'crashed': return 'Crashed';
      case 'zombie': return 'Zombie';
      default: return status;
    }
  };

  const restartSession = async (session: DashboardSession, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const key = `${session.owner}/${session.repo}#${session.issueNumber}`;
    if (restartingIssues.has(key)) return;

    setRestartingIssues(prev => new Set(prev).add(key));
    try {
      const res = await fetch('/api/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: session.owner, repo: session.repo, issueNumber: session.issueNumber }),
      });
      if (!res.ok) {
        const data = await res.json();
        console.error('Restart failed:', data.error);
      }
    } catch (e) {
      console.error('Restart request failed:', e);
    } finally {
      // Keep spinner for a bit, then clear
      setTimeout(() => {
        setRestartingIssues(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, 3000);
    }
  };

  const cleanupWorktree = async (session: DashboardSession, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const key = `${session.owner}/${session.repo}#${session.issueNumber}`;
    if (cleaningIssues.has(key)) return;

    setCleaningIssues(prev => new Set(prev).add(key));
    try {
      const res = await fetch('/api/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: session.owner, repo: session.repo, issueNumber: session.issueNumber }),
      });
      if (res.ok) {
        setSessions(prev => prev.map(s =>
          s.owner === session.owner && s.repo === session.repo && s.issueNumber === session.issueNumber
            ? { ...s, hasWorktree: false }
            : s
        ));
        setSelectedSession(null);
      } else {
        const data = await res.json();
        console.error('Cleanup failed:', data.error);
      }
    } catch (e) {
      console.error('Cleanup request failed:', e);
    } finally {
      setCleaningIssues(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'phase1_running': return 'bg-sky-500/15 text-status-running border-sky-500/30';
      case 'awaiting_approval': return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'phase2_running': return 'bg-blue-500/15 text-status-running border-blue-500/30';
      case 'awaiting_pr': return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
      case 'pr_open': return 'bg-emerald-500/15 text-status-completed border-emerald-500/30';
      case 'review_fixing': return 'bg-violet-500/15 text-violet-300 border-violet-500/30';
      case 'ci_fixing': return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
      case 'merged': return 'bg-emerald-500/15 text-status-completed border-emerald-500/30';
      case 'error': return 'bg-red-500/15 text-status-error border-red-500/30';
      case 'crashed': return 'bg-orange-500/15 text-status-crashed border-orange-500/30';
      case 'zombie': return 'bg-purple-500/15 text-status-zombie border-purple-500/30';
      default: return 'bg-gray-500/15 text-gray-300 border-gray-500/30';
    }
  };

  const getLogLevelColor = (level: string) => {
    if (level === 'info') return 'text-status-running';
    if (level === 'error') return 'text-status-error';
    if (level === 'warn') return 'text-status-crashed';
    if (level === 'success') return 'text-status-completed';
    return '';
  };

  const renderSessionLogLines = (entries: SessionLogEntry[], source: 'system' | 'agent' | 'merged') => {
    if (entries.length === 0) {
      return <div className="p-4 text-text-muted">No {source} logs yet.</div>;
    }

    return entries.map((entry, i) => (
      <div key={`${source}-${i}`} className="p-1.5 rounded break-all hover:bg-white/5 whitespace-pre-wrap">
        {entry.timestamp && (
          <span className="text-text-muted mr-2">
            {new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(entry.timestamp))}
          </span>
        )}
        {entry.level && (
          <span className={`font-semibold mr-2 uppercase ${getLogLevelColor(entry.level)}`}>[{entry.level}]</span>
        )}
        {entry.tag && (
          <span className="text-text-muted mr-2">({entry.tag})</span>
        )}
        {source === 'merged' && (
          <span className={`font-semibold mr-2 uppercase ${entry.source === 'system' ? 'text-sky-300' : 'text-amber-300'}`}>
            [{entry.source}]
          </span>
        )}
        <span>{entry.message}</span>
      </div>
    ));
  };

  const currentSelectedLogs =
    selectedLogTab === 'merged'
      ? selectedMergedLogs
      : selectedLogTab === 'system'
        ? selectedSystemLogs
        : selectedAgentLogs;

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden">
      <header className="flex flex-col gap-3 md:flex-row md:justify-between md:items-center px-4 py-4 md:px-6 md:py-5 border-b border-border-color shrink-0">
        <h1 className="font-semibold text-xl md:text-2xl tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
          🚀 ALONG Dashboard
        </h1>
        <div className="flex flex-wrap gap-1.5 md:gap-2">
          {statusFilters.map(filter => (
            <button
              key={filter}
              className={`px-2.5 py-1 md:px-3 md:py-1.5 rounded-md cursor-pointer text-xs md:text-sm transition-all border ${
                currentFilter === filter
                  ? 'bg-white/10 text-white border-border-color'
                  : 'bg-transparent border-transparent text-text-secondary hover:bg-white/5'
              }`}
              onClick={() => setCurrentFilter(filter)}
            >
              {filter === 'all' ? 'All' : getStatusLabel(filter)}
              {filter !== 'all' && <span className="opacity-60 ml-1.5">{(counts as any)[filter]}</span>}
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
                <div className="text-center text-text-muted px-4 py-8">No tasks found.</div>
              ) : null}
              {filteredSessions.map(session => (
                <div
                  key={`m-${session.owner}-${session.repo}-${session.issueNumber}`}
                  onClick={() => setSelectedSession(session)}
                  className="flex items-center gap-3 px-4 py-3 border-b border-white/5 cursor-pointer hover:bg-white/5 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium truncate">{session.owner}/{session.repo}</span>
                      <span className="text-text-secondary text-sm">
                        #{session.issueNumber}
                        {session.hasWorktree && <span className="ml-1 opacity-70" title="Worktree exists">📁</span>}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize border ${getStatusColor(session.status)}`}>
                        {getStatusLabel(session.status)}
                      </span>
                      <span className="text-text-muted text-xs">{session.runtime}</span>
                      {session.currentStep && (
                        <span className="text-text-muted text-xs truncate">{session.currentStep}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                    {isFailedStatus(session.status) && (
                      <button
                        className={`inline-flex items-center justify-center w-7 h-7 rounded-lg border border-transparent transition-all cursor-pointer ${
                          restartingIssues.has(`${session.owner}/${session.repo}#${session.issueNumber}`)
                            ? 'bg-blue-500/20 text-status-running animate-spin'
                            : 'bg-white/5 text-text-secondary hover:bg-blue-500/20 hover:text-status-running'
                        }`}
                        title="重启此任务"
                        onClick={(e) => restartSession(session, e)}
                        disabled={restartingIssues.has(`${session.owner}/${session.repo}#${session.issueNumber}`)}
                      >
                        🔄
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <table className="hidden lg:table w-full border-collapse text-left">
              <thead>
                <tr>
                  <th className="sticky top-0 bg-bg-secondary px-6 py-4 text-sm font-medium text-text-secondary border-b border-border-color z-10">Repo</th>
                  <th className="sticky top-0 bg-bg-secondary px-6 py-4 text-sm font-medium text-text-secondary border-b border-border-color z-10">Issue</th>
                  <th className="sticky top-0 bg-bg-secondary px-6 py-4 text-sm font-medium text-text-secondary border-b border-border-color z-10">Status</th>
                  <th className="sticky top-0 bg-bg-secondary px-6 py-4 text-sm font-medium text-text-secondary border-b border-border-color z-10">Runtime</th>
                  <th className="sticky top-0 bg-bg-secondary px-6 py-4 text-sm font-medium text-text-secondary border-b border-border-color z-10">Step</th>
                  <th className="sticky top-0 bg-bg-secondary px-6 py-4 text-sm font-medium text-text-secondary border-b border-border-color z-10 w-16">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-text-muted px-6 py-4">No tasks found.</td>
                  </tr>
                ) : null}
                {filteredSessions.map(session => (
                   <tr
                     key={`${session.owner}-${session.repo}-${session.issueNumber}`}
                     onClick={() => setSelectedSession(session)}
                     className="transition-colors cursor-pointer hover:bg-white/5"
                   >
                     <td className="px-6 py-4 border-b border-white/5 text-sm">{session.owner}/{session.repo}</td>
                     <td className="px-6 py-4 border-b border-white/5 text-sm">
                       #{session.issueNumber}
                       {session.hasWorktree && <span className="ml-2 opacity-70" title="Worktree exists">📁</span>}
                     </td>
                     <td className="px-6 py-4 border-b border-white/5 text-sm">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold capitalize border ${getStatusColor(session.status)}`}>
                          {getStatusLabel(session.status)}
                        </span>
                     </td>
                     <td className="px-6 py-4 border-b border-white/5 text-sm">{session.runtime}</td>
                     <td className="px-6 py-4 border-b border-white/5 text-sm max-w-[200px] whitespace-nowrap overflow-hidden text-ellipsis">
                        {session.currentStep || '-'}
                     </td>
                     <td className="px-6 py-4 border-b border-white/5 text-sm flex gap-2" onClick={e => e.stopPropagation()}>
                       {isFailedStatus(session.status) && (
                         <button
                           className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border border-transparent transition-all cursor-pointer ${
                             restartingIssues.has(`${session.owner}/${session.repo}#${session.issueNumber}`)
                               ? 'bg-blue-500/20 text-status-running animate-spin'
                               : 'bg-white/5 text-text-secondary hover:bg-blue-500/20 hover:text-status-running hover:border-blue-500/30'
                           }`}
                           title="重启此任务"
                           onClick={(e) => restartSession(session, e)}
                           disabled={restartingIssues.has(`${session.owner}/${session.repo}#${session.issueNumber}`)}
                         >
                           🔄
                         </button>
                       )}
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
             onClick={e => e.stopPropagation()}
           >
              <div className="p-4 md:p-6 border-b border-border-color flex justify-between items-center shrink-0">
                 <h2 className="text-base md:text-xl font-bold truncate mr-2">
                   {selectedSession.owner}/{selectedSession.repo} #{selectedSession.issueNumber}
                   {selectedSession.hasWorktree && <span className="ml-2 opacity-70" title="Worktree exists">📁</span>}
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
                     {selectedDiagnostic && isFailedStatus(selectedSession.status) && (
                        <div className="flex flex-col gap-3">
                           <div className="text-text-secondary font-medium text-xs md:text-sm">Failure Summary</div>
                           <div className="bg-black border border-border-color rounded-lg p-3 md:p-4 flex flex-col gap-3">
                             <div>
                               <div className="text-sm md:text-base font-semibold text-white">{selectedDiagnostic.summary}</div>
                               <div className="text-xs text-text-muted mt-1">
                                 {selectedDiagnostic.category}
                                 {selectedDiagnostic.phase ? ` · ${selectedDiagnostic.phase}` : ''}
                                 {typeof selectedDiagnostic.exitCode === 'number' ? ` · exit ${selectedDiagnostic.exitCode}` : ''}
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
                                   <div key={index} className="text-xs md:text-sm text-gray-300">{index + 1}. {hint}</div>
                                 ))}
                               </div>
                             )}
                           </div>
                        </div>
                     )}

                     <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-baseline md:gap-4">
                        <span className="text-text-secondary font-medium text-xs md:text-sm">Title</span>
                        <span className="text-sm md:text-base">{selectedSession.title}</span>
                     </div>
                     <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-baseline md:gap-4">
                        <span className="text-text-secondary font-medium text-xs md:text-sm">Status</span>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold capitalize border ${getStatusColor(selectedSession.status)}`}>
                            {getStatusLabel(selectedSession.status)}
                          </span>
                          {isFailedStatus(selectedSession.status) && (
                            <button
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                                restartingIssues.has(`${selectedSession.owner}/${selectedSession.repo}#${selectedSession.issueNumber}`)
                                  ? 'bg-blue-500/20 text-status-running border-blue-500/30 cursor-wait'
                                  : 'bg-blue-500/10 text-status-running border-blue-500/30 hover:bg-blue-500/25'
                              }`}
                              onClick={() => restartSession(selectedSession)}
                              disabled={restartingIssues.has(`${selectedSession.owner}/${selectedSession.repo}#${selectedSession.issueNumber}`)}
                            >
                              🔄 {restartingIssues.has(`${selectedSession.owner}/${selectedSession.repo}#${selectedSession.issueNumber}`) ? '重启中...' : '重启'}
                            </button>
                          )}
                        </div>
                     </div>
                     <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-baseline md:gap-4">
                        <span className="text-text-secondary font-medium text-xs md:text-sm">Runtime</span>
                        <span className="text-sm md:text-base">{selectedSession.runtime}</span>
                     </div>
                     <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-baseline md:gap-4">
                        <span className="text-text-secondary font-medium text-xs md:text-sm">Current Step</span>
                        <span className="text-sm md:text-base">{selectedSession.currentStep || 'N/A'}</span>
                     </div>
                     <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-baseline md:gap-4">
                        <span className="text-text-secondary font-medium text-xs md:text-sm">Last Message</span>
                        <span className="text-sm md:text-base">{selectedSession.lastMessage || 'N/A'}</span>
                     </div>

                     {selectedSession.hasWorktree && (
                        <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-baseline md:gap-4">
                           <span className="text-text-secondary font-medium text-xs md:text-sm">Worktree</span>
                           <div className="flex items-center gap-3 flex-wrap">
                             <span className="text-sm md:text-base opacity-70">📁 存在</span>
                             <button
                               className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                                 cleaningIssues.has(`${selectedSession.owner}/${selectedSession.repo}#${selectedSession.issueNumber}`)
                                   ? 'bg-red-500/20 text-red-400 border-red-500/30 cursor-wait'
                                   : 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/25'
                               }`}
                               onClick={(e) => cleanupWorktree(selectedSession, e)}
                               disabled={cleaningIssues.has(`${selectedSession.owner}/${selectedSession.repo}#${selectedSession.issueNumber}`)}
                             >
                               🗑️ {cleaningIssues.has(`${selectedSession.owner}/${selectedSession.repo}#${selectedSession.issueNumber}`) ? '清理中...' : '删除 Worktree'}
                             </button>
                           </div>
                        </div>
                     )}

                     {selectedSession.errorMessage && (
                        <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-start md:gap-4">
                           <span className="text-text-secondary font-medium text-xs md:text-sm">Error</span>
                           <div className="bg-black border border-border-color rounded-lg p-3 md:p-4 font-mono text-xs md:text-[13px] whitespace-pre-wrap text-status-error overflow-x-auto">
                             {selectedSession.errorMessage}
                           </div>
                        </div>
                     )}

                     {selectedSession.crashLog && (
                        <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-start md:gap-4">
                           <span className="text-text-secondary font-medium text-xs md:text-sm">Crash Log</span>
                           <div className="bg-black border border-border-color rounded-lg p-3 md:p-4 font-mono text-xs md:text-[13px] whitespace-pre-wrap text-white overflow-x-auto">
                             {selectedSession.crashLog}
                           </div>
                        </div>
                     )}
                   </div>

                   <div className="min-h-[320px] lg:min-h-0 lg:h-full flex flex-col gap-3 border-t border-white/5 pt-4 lg:pt-0 lg:border-t-0 lg:border-l lg:border-white/5 lg:pl-6">
                     <div className="flex items-center justify-between gap-3 flex-wrap">
                       <div>
                         <div className="text-text-secondary font-medium text-xs md:text-sm">Session Logs</div>
                         <div className="text-text-muted text-xs mt-1">Timeline 保持默认打开，便于直接排障。</div>
                       </div>
                       <div className="flex gap-2 flex-wrap">
                         <button
                           className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                             selectedLogTab === 'merged'
                               ? 'bg-white/10 text-white border-border-color'
                               : 'bg-transparent text-text-secondary border-border-color hover:bg-white/5'
                           }`}
                           onClick={() => setSelectedLogTab('merged')}
                         >
                           Timeline
                         </button>
                         <button
                           className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                             selectedLogTab === 'system'
                               ? 'bg-white/10 text-white border-border-color'
                               : 'bg-transparent text-text-secondary border-border-color hover:bg-white/5'
                           }`}
                           onClick={() => setSelectedLogTab('system')}
                         >
                           System Log
                         </button>
                         <button
                           className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                             selectedLogTab === 'agent'
                               ? 'bg-white/10 text-white border-border-color'
                               : 'bg-transparent text-text-secondary border-border-color hover:bg-white/5'
                           }`}
                           onClick={() => setSelectedLogTab('agent')}
                         >
                           Agent Log
                         </button>
                       </div>
                     </div>
                     <div className="bg-black border border-border-color rounded-lg p-3 md:p-4 font-mono text-xs md:text-[13px] text-gray-300 overflow-auto flex-1 min-h-0 flex flex-col gap-1.5">
                       {selectedLogsLoading
                         ? <div className="p-4 text-text-muted">Loading logs...</div>
                         : renderSessionLogLines(currentSelectedLogs, selectedLogTab)}
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
