import { ConversationLog } from './ConversationLog';
import { LogEntries } from './LogEntries';
import type { LogTab, useSessionLogs } from './useSessionLogs';

type SessionLogsState = ReturnType<typeof useSessionLogs>;

export function SessionLogsPanel({ logs }: { logs: SessionLogsState }) {
  const tabs: LogTab[] = [
    'timeline',
    'lifecycle',
    'conversation',
    'diagnostic',
  ];
  return (
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
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                logs.selectedLogTab === tab
                  ? 'bg-white/10 text-white border-border-color'
                  : 'bg-transparent text-text-secondary border-border-color hover:bg-white/5'
              }`}
              onClick={() => logs.setSelectedLogTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="bg-black border border-border-color rounded-lg p-3 md:p-4 font-mono text-xs md:text-[13px] text-gray-300 overflow-auto flex-1 min-h-0 flex flex-col gap-1.5">
        {logs.selectedLogTab === 'conversation' ? (
          <ConversationLog
            files={logs.conversationFiles}
            activeFile={logs.activeConvFile}
            messages={logs.conversationMessages}
            loading={logs.convLoading}
            onSelectFile={logs.selectConversationFile}
          />
        ) : logs.selectedLogsLoading ? (
          <div className="p-4 text-text-muted">Loading logs...</div>
        ) : (
          <LogEntries
            entries={logs.filteredLogs}
            showCategory={logs.selectedLogTab === 'timeline'}
          />
        )}
      </div>
    </div>
  );
}
