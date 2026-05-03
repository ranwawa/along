import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationMessage, DashboardSession } from '../types';
import { sessionParams } from './sessionLogUtils';

type SetConversationMessages = React.Dispatch<
  React.SetStateAction<ConversationMessage[]>
>;
type ConversationMessageRuntime = {
  setConversationMessages: SetConversationMessages;
  setConvLoading: React.Dispatch<React.SetStateAction<boolean>>;
  sseRef: React.MutableRefObject<EventSource | null>;
};

export function useConversationMessages(
  selectedSession: DashboardSession | null,
  activeConvFile: string | null,
) {
  const messageState = useConversationMessageState();

  useEffect(() => {
    messageState.runtime.sseRef.current?.close();
    if (!selectedSession || !activeConvFile) {
      resetConversationMessages(messageState.runtime.setConversationMessages);
      return;
    }
    return openConversationMessages(
      selectedSession,
      activeConvFile,
      messageState.runtime,
    );
  }, [selectedSession, activeConvFile, messageState.runtime]);

  return {
    conversationMessages: messageState.conversationMessages,
    convLoading: messageState.convLoading,
  };
}

function useConversationMessageState() {
  const [conversationMessages, setConversationMessages] = useState<
    ConversationMessage[]
  >([]);
  const [convLoading, setConvLoading] = useState(false);
  const sseRef = useRef<EventSource | null>(null);
  const runtime = useMemo(
    () => ({ setConversationMessages, setConvLoading, sseRef }),
    [],
  );
  return { conversationMessages, convLoading, runtime };
}

function openConversationMessages(
  selectedSession: DashboardSession,
  activeConvFile: string,
  state: ConversationMessageRuntime,
) {
  let active = true;
  state.setConvLoading(true);
  const params = sessionParams(selectedSession, activeConvFile);
  loadConversationMessages(
    params,
    active,
    state.setConversationMessages,
  ).finally(() => active && state.setConvLoading(false));
  const sse = new EventSource(`/api/logs/conversation/stream?${params}`);
  state.sseRef.current = sse;
  sse.onmessage = (event) =>
    appendConversationEvent(event, active, state.setConversationMessages);
  return () =>
    closeConversationMessages(sse, state, () => {
      active = false;
    });
}

function closeConversationMessages(
  sse: EventSource,
  state: ConversationMessageRuntime,
  deactivate: () => void,
) {
  deactivate();
  sse.close();
  state.sseRef.current = null;
}

async function loadConversationMessages(
  params: URLSearchParams,
  active: boolean,
  setMessages: SetConversationMessages,
) {
  try {
    const res = await fetch(`/api/logs/conversation?${params}`);
    if (active) setMessages(res.ok ? await res.json() : []);
  } catch {
    if (active) setMessages([]);
  }
}

function appendConversationEvent(
  event: MessageEvent,
  active: boolean,
  setMessages: SetConversationMessages,
) {
  if (!active) return;
  try {
    const entries = JSON.parse(event.data);
    if (Array.isArray(entries)) setMessages((prev) => [...prev, ...entries]);
  } catch {}
}

function resetConversationMessages(setMessages: SetConversationMessages) {
  setMessages([]);
}
