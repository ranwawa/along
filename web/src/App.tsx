import { useState, useEffect, useMemo } from 'react';
import type { DashboardSession, LogEntry, StatusCounts } from './types';
import './index.css';

function App() {
  const [sessions, setSessions] = useState<DashboardSession[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [currentFilter, setCurrentFilter] = useState<string>('all');
  const [selectedSession, setSelectedSession] = useState<DashboardSession | null>(null);
  const [restartingIssues, setRestartingIssues] = useState<Set<string>>(new Set());

  // Poll sessions
  useEffect(() => {
    let active = true;
    const fetchSessions = async () => {
      try {
        const res = await fetch('/api/sessions');
        if (!res.ok) return;
        const data = await res.json();
        if (active) {
          // Sort by start time descending
          data.sort((a: DashboardSession, b: DashboardSession) => {
            const pa = a.status === 'running' ? 0 : 1;
            const pb = b.status === 'running' ? 0 : 1;
            if (pa !== pb) return pa - pb;
            return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
          });
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

  // Poll logs (SSE)
  useEffect(() => {
    const evtSource = new EventSource('/api/logs');
    evtSource.onmessage = (event) => {
      try {
        const newLogs = JSON.parse(event.data);
        setLogs(newLogs);
      } catch(e) {}
    };
    return () => evtSource.close();
  }, []);

  const [viewingLogSession, setViewingLogSession] = useState<DashboardSession | null>(null);
  const [agentLogContent, setAgentLogContent] = useState<string>('');
  const [sysLogExpanded, setSysLogExpanded] = useState(false);

  useEffect(() => {
    if (!viewingLogSession) return;
    let active = true;
    const fetchLog = async () => {
       try {
         const res = await fetch(`/api/agent-logs?owner=${encodeURIComponent(viewingLogSession.owner)}&repo=${encodeURIComponent(viewingLogSession.repo)}&issueNumber=${viewingLogSession.issueNumber}`);
         if (res.ok && active) {
            setAgentLogContent(await res.text());
         }
       } catch (e) {}
    };
    fetchLog();
    const timer = setInterval(fetchLog, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [viewingLogSession]);

  const counts = useMemo<StatusCounts>(() => {
    const defaultCounts: StatusCounts = { running: 0, completed: 0, error: 0, crashed: 0, zombie: 0, total: sessions.length };
    for (const s of sessions) {
      if (s.status in defaultCounts) {
        (defaultCounts as any)[s.status]++;
      }
    }
    return defaultCounts;
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    if (currentFilter === 'all') return sessions;
    return sessions.filter(s => s.status === currentFilter);
  }, [sessions, currentFilter]);

  const isFailedStatus = (status: string) => ['error', 'crashed', 'zombie'].includes(status);

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

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'running': return 'bg-blue-500/15 text-status-running border-blue-500/30';
      case 'completed': return 'bg-emerald-500/15 text-status-completed border-emerald-500/30';
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

  return (
    <div className="max-w-[1400px] mx-auto p-4 md:p-6 lg:p-8 flex flex-col gap-4 md:gap-6 lg:gap-8 h-screen">
      <header className="flex flex-col gap-3 md:flex-row md:justify-between md:items-center pb-4 md:pb-6 border-b border-border-color">
        <h1 className="font-semibold text-xl md:text-2xl tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
          🚀 ALONG Dashboard
        </h1>
        <div className="flex flex-wrap gap-1.5 md:gap-2">
          {['all', 'running', 'completed', 'error', 'crashed', 'zombie'].map(filter => (
            <button
              key={filter}
              className={`px-2.5 py-1 md:px-3 md:py-1.5 rounded-md cursor-pointer text-xs md:text-sm transition-all border ${
                currentFilter === filter
                  ? 'bg-white/10 text-white border-border-color'
                  : 'bg-transparent border-transparent text-text-secondary hover:bg-white/5'
              }`}
              onClick={() => setCurrentFilter(filter)}
            >
              {filter.charAt(0).toUpperCase() + filter.slice(1)}
              {filter !== 'all' && <span className="opacity-60 ml-1.5">{(counts as any)[filter]}</span>}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 md:gap-4">
        <div className="bg-bg-glass backdrop-blur-md border border-border-color rounded-xl p-4 md:p-6 flex flex-col gap-1.5 md:gap-2 transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]">
          <span className="text-text-secondary text-xs md:text-sm font-medium uppercase tracking-wider">Total Tasks</span>
          <span className="text-2xl md:text-3xl font-bold">{counts.total}</span>
        </div>
        <div className="bg-bg-glass backdrop-blur-md border border-border-color rounded-xl p-4 md:p-6 flex flex-col gap-1.5 md:gap-2 transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]">
          <span className="text-status-running text-xs md:text-sm font-medium uppercase tracking-wider">Running</span>
          <span className="text-2xl md:text-3xl font-bold">{counts.running}</span>
        </div>
        <div className="bg-bg-glass backdrop-blur-md border border-border-color rounded-xl p-4 md:p-6 flex flex-col gap-1.5 md:gap-2 transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]">
          <span className="text-status-completed text-xs md:text-sm font-medium uppercase tracking-wider">Completed</span>
          <span className="text-2xl md:text-3xl font-bold">{counts.completed}</span>
        </div>
        <div className="bg-bg-glass backdrop-blur-md border border-border-color rounded-xl p-4 md:p-6 flex flex-col gap-1.5 md:gap-2 transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]">
          <span className="text-status-error text-xs md:text-sm font-medium uppercase tracking-wider">Exceptions</span>
          <span className="text-2xl md:text-3xl font-bold">{counts.error + counts.crashed + counts.zombie}</span>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 lg:gap-8 flex-1 min-h-0">
        <div className="flex-1 lg:flex-[2] bg-bg-glass backdrop-blur-md border border-border-color rounded-xl flex flex-col overflow-hidden min-h-[300px] lg:min-h-0">
          <div className="px-4 py-3 md:px-6 md:py-5 border-b border-border-color font-semibold text-sm md:text-base">Recent Tasks</div>
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
                      <span className="text-text-secondary text-sm">#{session.issueNumber}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize border ${getStatusColor(session.status)}`}>
                        {session.status}
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
                    <button
                      className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-transparent transition-all cursor-pointer bg-white/5 text-text-secondary hover:bg-white/20 hover:text-white"
                      title="查看 Agent 完整日志"
                      onClick={(e) => { e.stopPropagation(); setViewingLogSession(session); }}
                    >
                      📄
                    </button>
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
                     <td className="px-6 py-4 border-b border-white/5 text-sm">#{session.issueNumber}</td>
                     <td className="px-6 py-4 border-b border-white/5 text-sm">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold capitalize border ${getStatusColor(session.status)}`}>
                          {session.status}
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
                       <button
                         className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-transparent transition-all cursor-pointer bg-white/5 text-text-secondary hover:bg-white/20 hover:text-white"
                         title="查看 Agent 完整日志"
                         onClick={(e) => { e.stopPropagation(); setViewingLogSession(session); }}
                       >
                         📄
                       </button>
                     </td>
                   </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="max-h-[300px] lg:max-h-none lg:flex-1 bg-bg-glass backdrop-blur-md border border-border-color rounded-xl flex flex-col overflow-hidden">
          <div className="px-4 py-3 md:px-6 md:py-5 border-b border-border-color font-semibold border-l-4 border-l-brand flex justify-between items-center text-sm md:text-base">
             <span>System Logs</span>
             <button title="全屏显示" className="bg-transparent text-text-secondary cursor-pointer hover:text-white" onClick={() => setSysLogExpanded(true)}>⛶</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 md:p-4 font-mono text-xs md:text-[13px] flex flex-col gap-1.5">
            {logs.map((log, i) => (
              <div key={i} className="p-1.5 rounded break-all hover:bg-white/5">
                 <span className="text-text-muted mr-1.5 md:mr-2">{new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(log.timestamp))}</span>
                 <span className={`font-semibold mr-1.5 md:mr-2 uppercase ${getLogLevelColor(log.level)}`}>[{log.level}]</span>
                 {log.tag && <span className="text-text-muted mr-1.5 md:mr-2">({log.tag})</span>}
                 <span>{log.message}</span>
              </div>
            ))}
            {logs.length === 0 && <div className="p-4 text-text-muted">Waiting for logs...</div>}
          </div>
        </div>
      </div>

      {selectedSession && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center z-50 p-0 md:p-8 animate-[fadeIn_0.2s_ease]"
          onClick={() => setSelectedSession(null)}
        >
           <div
             className="bg-bg-secondary border border-border-color rounded-t-2xl md:rounded-2xl w-full max-w-[800px] max-h-[85vh] md:max-h-[90vh] flex flex-col shadow-2xl animate-[slideUp_0.3s_cubic-bezier(0.16,1,0.3,1)]"
             onClick={e => e.stopPropagation()}
           >
              <div className="p-4 md:p-6 border-b border-border-color flex justify-between items-center">
                 <h2 className="text-base md:text-xl font-bold truncate mr-2">{selectedSession.owner}/{selectedSession.repo} #{selectedSession.issueNumber}</h2>
                 <button
                   className="bg-transparent border-none text-text-secondary cursor-pointer p-2 rounded-lg transition-colors hover:bg-white/10 hover:text-white shrink-0"
                   onClick={() => setSelectedSession(null)}
                 >
                   ✕
                 </button>
              </div>
              <div className="p-4 md:p-6 overflow-y-auto flex flex-col gap-4 md:gap-6">
                 <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-baseline md:gap-4">
                    <span className="text-text-secondary font-medium text-xs md:text-sm">Title</span>
                    <span className="text-sm md:text-base">{selectedSession.title}</span>
                 </div>
                 <div className="flex flex-col gap-1 md:grid md:grid-cols-[140px_1fr] md:items-baseline md:gap-4">
                    <span className="text-text-secondary font-medium text-xs md:text-sm">Status</span>
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold capitalize border ${getStatusColor(selectedSession.status)}`}>
                        {selectedSession.status}
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
           </div>
        </div>
      )}

      {viewingLogSession && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end md:items-center justify-center z-50 p-0 md:p-4" onClick={() => setViewingLogSession(null)}>
           <div className="bg-bg-secondary border border-border-color rounded-t-2xl md:rounded-2xl w-full max-w-[1200px] h-[85vh] md:h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="p-3 md:p-4 border-b border-border-color flex justify-between items-center bg-bg-glass">
                 <h2 className="text-sm md:text-lg font-bold flex items-center gap-2 md:gap-3 truncate mr-2">
                   📄 <span className="hidden md:inline">Agent Logs:</span><span className="md:hidden">Logs:</span> {viewingLogSession.owner}/{viewingLogSession.repo} #{viewingLogSession.issueNumber}
                   {viewingLogSession.status === 'running' && <span className="text-xs bg-status-running/20 text-status-running px-2 py-1 rounded shrink-0">Live</span>}
                 </h2>
                 <button className="text-text-secondary hover:text-white bg-transparent text-xl cursor-pointer p-2 shrink-0" onClick={() => setViewingLogSession(null)}>✕</button>
              </div>
              <div className="flex-1 overflow-auto p-3 md:p-4 bg-black font-mono text-xs md:text-[13px] text-gray-300">
                <pre className="whitespace-pre-wrap break-words m-0">{agentLogContent || 'Loading or missing logs...'}</pre>
              </div>
           </div>
        </div>
      )}

      {sysLogExpanded && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end md:items-center justify-center z-50 p-0 md:p-4" onClick={() => setSysLogExpanded(false)}>
           <div className="bg-bg-secondary border border-border-color rounded-t-2xl md:rounded-2xl w-full max-w-[1200px] h-[85vh] md:h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="p-3 md:p-4 border-b border-border-color flex justify-between items-center bg-bg-glass">
                 <h2 className="text-sm md:text-lg font-bold flex items-center gap-2 md:gap-3">💻 Full System Logs (Live)</h2>
                 <button className="text-text-secondary hover:text-white bg-transparent text-xl cursor-pointer p-2" onClick={() => setSysLogExpanded(false)}>✕</button>
              </div>
              <div className="flex-1 overflow-auto p-3 md:p-4 bg-black font-mono text-xs md:text-[13px] text-gray-300 flex flex-col gap-1.5 flex-col-reverse">
                {[...logs].reverse().map((log, i) => (
                  <div key={i} className="p-1 break-all hover:bg-white/5 whitespace-pre-wrap">
                     <span className="text-text-muted mr-1.5 md:mr-2">{new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(log.timestamp))}</span>
                     <span className={`font-semibold mr-1.5 md:mr-2 uppercase ${getLogLevelColor(log.level)}`}>[{log.level}]</span>
                     {log.tag && <span className="text-text-muted mr-1.5 md:mr-2">({log.tag})</span>}
                     <span>{log.message}</span>
                  </div>
                ))}
              </div>
           </div>
        </div>
      )}

    </div>
  );
}

export default App;
