import { useEffect, useRef, useState } from 'react';
import type {
  DashboardSession,
  SessionDiagnostic,
  UnifiedLogEntry,
} from '../types';
import { sessionParams } from './sessionLogUtils';

type SetLogs = React.Dispatch<React.SetStateAction<UnifiedLogEntry[]>>;
type SetDiagnostic = React.Dispatch<
  React.SetStateAction<SessionDiagnostic | null>
>;

export function useBaseSessionLogs(selectedSession: DashboardSession | null) {
  const [sessionLogs, setSessionLogs] = useState<UnifiedLogEntry[]>([]);
  const [selectedDiagnostic, setSelectedDiagnostic] =
    useState<SessionDiagnostic | null>(null);
  const [selectedLogsLoading, setSelectedLogsLoading] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!selectedSession) {
      resetSessionLogs(setSessionLogs, setSelectedDiagnostic);
      sseRef.current?.close();
      return;
    }
    return openSessionLogs(
      selectedSession,
      setSessionLogs,
      setSelectedDiagnostic,
      setSelectedLogsLoading,
      sseRef,
    );
  }, [selectedSession]);

  return { sessionLogs, selectedDiagnostic, selectedLogsLoading };
}

function resetSessionLogs(setLogs: SetLogs, setDiagnostic: SetDiagnostic) {
  setLogs([]);
  setDiagnostic(null);
}

function openSessionLogs(
  selectedSession: DashboardSession,
  setLogs: SetLogs,
  setDiagnostic: SetDiagnostic,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>,
  sseRef: React.MutableRefObject<EventSource | null>,
) {
  let active = true;
  setLoading(true);
  const params = sessionParams(selectedSession);
  loadSessionLogs(params, active, setLogs, setDiagnostic).finally(
    () => active && setLoading(false),
  );
  const sse = new EventSource(`/api/logs/session/stream?${params}`);
  sseRef.current = sse;
  sse.onmessage = (event) => appendLogEvent(event, active, setLogs);
  return () =>
    closeSessionLogs(sse, sseRef, () => {
      active = false;
    });
}

function closeSessionLogs(
  sse: EventSource,
  sseRef: React.MutableRefObject<EventSource | null>,
  deactivate: () => void,
) {
  deactivate();
  sse.close();
  sseRef.current = null;
}

async function loadSessionLogs(
  params: URLSearchParams,
  active: boolean,
  setLogs: SetLogs,
  setDiagnostic: SetDiagnostic,
) {
  try {
    const [logsRes, diagnosticRes] = await Promise.all([
      fetch(`/api/logs/session?${params}&maxLines=500`),
      fetch(`/api/logs/diagnostic?${params}`),
    ]);
    if (!active) return;
    setLogs(logsRes.ok ? await logsRes.json() : []);
    setDiagnostic(diagnosticRes.ok ? await diagnosticRes.json() : null);
  } catch {
    if (!active) return;
    resetSessionLogs(setLogs, setDiagnostic);
  }
}

function appendLogEvent(
  event: MessageEvent,
  active: boolean,
  setLogs: SetLogs,
) {
  if (!active) return;
  try {
    setLogs((prev) => [...prev, JSON.parse(event.data)]);
  } catch {}
}
