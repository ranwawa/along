import { useState, useEffect, useMemo } from 'react';
import type { DashboardSession, LogEntry, StatusCounts } from './types';
import './index.css';

function App() {
  const [sessions, setSessions] = useState<DashboardSession[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [currentFilter, setCurrentFilter] = useState<string>('all');
  const [selectedSession, setSelectedSession] = useState<DashboardSession | null>(null);

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
    <div className="max-w-[1400px] mx-auto p-8 flex flex-col gap-8 h-screen">
      <header className="flex justify-between items-center pb-6 border-b border-border-color">
        <h1 className="font-semibold text-2xl tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
          🚀 ALONG Dashboard
        </h1>
        <div className="flex gap-2">
          {['all', 'running', 'completed', 'error', 'crashed', 'zombie'].map(filter => (
            <button 
              key={filter} 
              className={`px-3 py-1.5 rounded-md cursor-pointer text-sm transition-all border ${
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

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <div className="bg-bg-glass backdrop-blur-md border border-border-color rounded-xl p-6 flex flex-col gap-2 transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]">
          <span className="text-text-secondary text-sm font-medium uppercase tracking-wider">Total Tasks</span>
          <span className="text-3xl font-bold">{counts.total}</span>
        </div>
        <div className="bg-bg-glass backdrop-blur-md border border-border-color rounded-xl p-6 flex flex-col gap-2 transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]">
          <span className="text-status-running text-sm font-medium uppercase tracking-wider">Running</span>
          <span className="text-3xl font-bold">{counts.running}</span>
        </div>
        <div className="bg-bg-glass backdrop-blur-md border border-border-color rounded-xl p-6 flex flex-col gap-2 transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]">
          <span className="text-status-completed text-sm font-medium uppercase tracking-wider">Completed</span>
          <span className="text-3xl font-bold">{counts.completed}</span>
        </div>
        <div className="bg-bg-glass backdrop-blur-md border border-border-color rounded-xl p-6 flex flex-col gap-2 transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]">
          <span className="text-status-error text-sm font-medium uppercase tracking-wider">Exceptions</span>
          <span className="text-3xl font-bold">{counts.error + counts.crashed + counts.zombie}</span>
        </div>
      </div>

      <div className="flex gap-8 flex-1 min-h-0">
        <div className="flex-[2] bg-bg-glass backdrop-blur-md border border-border-color rounded-xl flex flex-col overflow-hidden">
          <div className="px-6 py-5 border-b border-border-color font-semibold">Recent Tasks</div>
          <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th className="sticky top-0 bg-bg-secondary px-6 py-4 text-sm font-medium text-text-secondary border-b border-border-color z-10">Repo</th>
                  <th className="sticky top-0 bg-bg-secondary px-6 py-4 text-sm font-medium text-text-secondary border-b border-border-color z-10">Issue</th>
                  <th className="sticky top-0 bg-bg-secondary px-6 py-4 text-sm font-medium text-text-secondary border-b border-border-color z-10">Status</th>
                  <th className="sticky top-0 bg-bg-secondary px-6 py-4 text-sm font-medium text-text-secondary border-b border-border-color z-10">Runtime</th>
                  <th className="sticky top-0 bg-bg-secondary px-6 py-4 text-sm font-medium text-text-secondary border-b border-border-color z-10">Step</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-text-muted px-6 py-4">No tasks found.</td>
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
                   </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex-1 bg-bg-glass backdrop-blur-md border border-border-color rounded-xl flex flex-col overflow-hidden">
          <div className="px-6 py-5 border-b border-border-color font-semibold border-l-4 border-l-brand">System Logs</div>
          <div className="flex-1 overflow-y-auto p-4 font-mono text-[13px] flex flex-col gap-1.5">
            {logs.map((log, i) => (
              <div key={i} className="p-1.5 rounded break-all hover:bg-white/5">
                 <span className="text-text-muted mr-2">{new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(log.timestamp))}</span>
                 <span className={`font-semibold mr-2 uppercase ${getLogLevelColor(log.level)}`}>[{log.level}]</span>
                 {log.tag && <span className="text-text-muted mr-2">({log.tag})</span>}
                 <span>{log.message}</span>
              </div>
            ))}
            {logs.length === 0 && <div className="p-4 text-text-muted">Waiting for logs...</div>}
          </div>
        </div>
      </div>

      {selectedSession && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-8 animate-[fadeIn_0.2s_ease]" 
          onClick={() => setSelectedSession(null)}
        >
           <div 
             className="bg-bg-secondary border border-border-color rounded-2xl w-full max-w-[800px] max-h-[90vh] flex flex-col shadow-2xl animate-[slideUp_0.3s_cubic-bezier(0.16,1,0.3,1)]" 
             onClick={e => e.stopPropagation()}
           >
              <div className="p-6 border-b border-border-color flex justify-between items-center">
                 <h2 className="text-xl font-bold">{selectedSession.owner}/{selectedSession.repo} #{selectedSession.issueNumber}</h2>
                 <button 
                   className="bg-transparent border-none text-text-secondary cursor-pointer p-2 rounded-lg transition-colors hover:bg-white/10 hover:text-white" 
                   onClick={() => setSelectedSession(null)}
                 >
                   ✕
                 </button>
              </div>
              <div className="p-6 overflow-y-auto flex flex-col gap-6">
                 <div className="grid grid-cols-[140px_1fr] items-baseline gap-4">
                    <span className="text-text-secondary font-medium text-sm">Title</span>
                    <span>{selectedSession.title}</span>
                 </div>
                 <div className="grid grid-cols-[140px_1fr] items-baseline gap-4">
                    <span className="text-text-secondary font-medium text-sm">Status</span>
                    <div>
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold capitalize border ${getStatusColor(selectedSession.status)}`}>
                        {selectedSession.status}
                      </span>
                    </div>
                 </div>
                 <div className="grid grid-cols-[140px_1fr] items-baseline gap-4">
                    <span className="text-text-secondary font-medium text-sm">Runtime</span>
                    <span>{selectedSession.runtime}</span>
                 </div>
                 <div className="grid grid-cols-[140px_1fr] items-baseline gap-4">
                    <span className="text-text-secondary font-medium text-sm">Current Step</span>
                    <span>{selectedSession.currentStep || 'N/A'}</span>
                 </div>
                 <div className="grid grid-cols-[140px_1fr] items-baseline gap-4">
                    <span className="text-text-secondary font-medium text-sm">Last Message</span>
                    <span>{selectedSession.lastMessage || 'N/A'}</span>
                 </div>
                 
                 {selectedSession.errorMessage && (
                    <div className="grid grid-cols-[140px_1fr] items-start gap-4">
                       <span className="text-text-secondary font-medium text-sm">Error</span>
                       <div className="bg-black border border-border-color rounded-lg p-4 font-mono text-[13px] whitespace-pre-wrap text-status-error">
                         {selectedSession.errorMessage}
                       </div>
                    </div>
                 )}

                 {selectedSession.crashLog && (
                    <div className="grid grid-cols-[140px_1fr] items-start gap-4">
                       <span className="text-text-secondary font-medium text-sm">Crash Log</span>
                       <div className="bg-black border border-border-color rounded-lg p-4 font-mono text-[13px] whitespace-pre-wrap text-white">
                         {selectedSession.crashLog}
                       </div>
                    </div>
                 )}
              </div>
           </div>
        </div>
      )}
    </div>
  );
}

export default App;
