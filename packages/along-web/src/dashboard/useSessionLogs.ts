import { useEffect, useMemo, useState } from 'react';
import type { DashboardSession } from '../types';
import { filterLogs, type LogTab } from './sessionLogUtils';
import { useBaseSessionLogs } from './useBaseSessionLogs';
import { useConversationFiles } from './useConversationFiles';
import { useConversationMessages } from './useConversationMessages';

export type { LogTab } from './sessionLogUtils';

function resetTabForSession(
  session: DashboardSession | null,
  setSelectedLogTab: React.Dispatch<React.SetStateAction<LogTab>>,
) {
  if (session || session === null) setSelectedLogTab('timeline');
}

export function useSessionLogs(selectedSession: DashboardSession | null) {
  const [selectedLogTab, setSelectedLogTab] = useState<LogTab>('timeline');
  const baseLogs = useBaseSessionLogs(selectedSession);
  const files = useConversationFiles(selectedSession, selectedLogTab);
  const messages = useConversationMessages(
    selectedSession,
    files.activeConvFile,
  );
  useEffect(
    () => resetTabForSession(selectedSession, setSelectedLogTab),
    [selectedSession],
  );
  const filteredLogs = useMemo(
    () => filterLogs(baseLogs.sessionLogs, selectedLogTab),
    [baseLogs.sessionLogs, selectedLogTab],
  );
  return {
    selectedLogTab,
    setSelectedLogTab,
    filteredLogs,
    ...baseLogs,
    ...files,
    ...messages,
  };
}
