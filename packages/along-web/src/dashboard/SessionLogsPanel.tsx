// biome-ignore-all lint/style/noJsxLiterals: existing dashboard view uses inline labels.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: log tabs and content branch are kept together for readability.
import { Activity, BotMessageSquare, FileSearch, ListTree } from 'lucide-react';
import { Button } from '../components/ui/button';
import { ConversationLog } from './ConversationLog';
import { LogEntries } from './LogEntries';
import type { LogTab, useSessionLogs } from './useSessionLogs';

type SessionLogsState = ReturnType<typeof useSessionLogs>;

const tabIcon = {
  timeline: Activity,
  lifecycle: ListTree,
  conversation: BotMessageSquare,
  diagnostic: FileSearch,
} satisfies Record<LogTab, typeof Activity>;

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
            <LogTabButton
              key={tab}
              tab={tab}
              active={logs.selectedLogTab === tab}
              onClick={() => logs.setSelectedLogTab(tab)}
            />
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

function LogTabButton({
  tab,
  active,
  onClick,
}: {
  tab: LogTab;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = tabIcon[tab];
  return (
    <Button
      type="button"
      variant="tab"
      size="sm"
      className={`gap-1.5 ${active ? 'bg-white/10 text-white' : ''}`}
      onClick={onClick}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
      {tab.charAt(0).toUpperCase() + tab.slice(1)}
    </Button>
  );
}
