import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationFileInfo, DashboardSession } from '../types';
import { type LogTab, sessionParams } from './sessionLogUtils';

type ConversationFileRuntime = {
  setConversationFiles: React.Dispatch<
    React.SetStateAction<ConversationFileInfo[]>
  >;
  setActiveConvFile: React.Dispatch<React.SetStateAction<string | null>>;
  userSelected: React.MutableRefObject<boolean>;
  activeFileRef: React.MutableRefObject<string | null>;
};

export function useConversationFiles(
  selectedSession: DashboardSession | null,
  selectedLogTab: LogTab,
) {
  const fileState = useConversationFileState();

  useEffect(() => {
    if (!selectedSession || selectedLogTab !== 'conversation') {
      resetConversationFiles(fileState.runtime);
      return;
    }
    const load = () =>
      loadConversationFiles(selectedSession, fileState.runtime);
    load();
    const pollId = setInterval(load, 5000);
    return () => clearInterval(pollId);
  }, [selectedSession, selectedLogTab, fileState.runtime]);

  return {
    conversationFiles: fileState.conversationFiles,
    activeConvFile: fileState.activeConvFile,
    selectConversationFile: fileState.selectConversationFile,
  };
}

function useConversationFileState() {
  const [conversationFiles, setConversationFiles] = useState<
    ConversationFileInfo[]
  >([]);
  const [activeConvFile, setActiveConvFile] = useState<string | null>(null);
  const userSelected = useRef(false);
  const activeFileRef = useRef<string | null>(null);
  const runtime = useMemo(
    () => ({
      setConversationFiles,
      setActiveConvFile,
      userSelected,
      activeFileRef,
    }),
    [],
  );
  const selectConversationFile = useCallback((filename: string) => {
    userSelected.current = true;
    activeFileRef.current = filename;
    setActiveConvFile(filename);
  }, []);
  return { conversationFiles, activeConvFile, runtime, selectConversationFile };
}

function resetConversationFiles(state: ConversationFileRuntime) {
  state.setConversationFiles([]);
  state.setActiveConvFile(null);
  state.userSelected.current = false;
}

async function loadConversationFiles(
  session: DashboardSession,
  state: ConversationFileRuntime,
) {
  try {
    const res = await fetch(
      `/api/logs/conversation/files?${sessionParams(session)}`,
    );
    if (!res.ok) return;
    updateConversationFiles(
      (await res.json()) as ConversationFileInfo[],
      state,
    );
  } catch {}
}

function updateConversationFiles(
  files: ConversationFileInfo[],
  state: ConversationFileRuntime,
) {
  state.setConversationFiles(files);
  const latest = files[files.length - 1]?.filename;
  const stillExists = files.some(
    (file) => file.filename === state.activeFileRef.current,
  );
  if (!latest || (state.userSelected.current && stillExists)) return;
  state.setActiveConvFile(latest);
  state.activeFileRef.current = latest;
}
