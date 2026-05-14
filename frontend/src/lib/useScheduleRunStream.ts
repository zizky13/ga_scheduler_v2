import { useEffect, useRef, useState } from 'react';
import { getAccessToken } from './api';

export interface SSEProgressPayload {
  runId: string;
  status: 'RUNNING';
  currentGeneration: number;
  bestFitness: number;
  avgFitness: number;
  hardViolations: number;
  softPenalty: number;
  competencyMismatch: number;
  structuralPenalty: number;
  preferencePenalty: number;
}

export interface SSEStatePayload {
  runId: string;
  status: string;
}

export interface SSEErrorPayload {
  code: string;
  message: string;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface StreamHandlers {
  onProgress: (data: SSEProgressPayload) => void;
  onState: (data: SSEStatePayload) => void;
  onError: (data: SSEErrorPayload) => void;
  onReconnected: () => void;
}

const MAX_RETRIES = 7;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

function backoffDelay(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}

const TERMINAL = new Set([
  'COMPLETED', 'STAGNATED', 'SSA_INFEASIBLE', 'PRE_GA_EMPTY', 'CANCELLED', 'FAILED',
]);

async function consumeStream(
  url: string,
  token: string,
  signal: AbortSignal,
  on: {
    open: () => void;
    progress: (d: SSEProgressPayload) => void;
    state: (d: SSEStatePayload) => void;
    error: (d: SSEErrorPayload) => void;
  },
): Promise<boolean> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    credentials: 'include',
    signal,
  });

  if (!res.ok) throw new Error(`SSE ${res.status}`);
  on.open();

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let terminal = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const parts = buf.split('\n\n');
      buf = parts.pop()!;

      for (const raw of parts) {
        const m = raw.trim();
        if (!m || m === ': heartbeat') continue;

        let ev = '';
        let data = '';
        for (const line of m.split('\n')) {
          if (line.startsWith('event: ')) ev = line.slice(7);
          else if (line.startsWith('data: ')) data = line.slice(6);
        }
        if (!ev || !data) continue;

        try {
          const p = JSON.parse(data);
          if (ev === 'progress') on.progress(p);
          else if (ev === 'state') {
            if (TERMINAL.has(p.status)) terminal = true;
            on.state(p);
          } else if (ev === 'error') on.error(p);
        } catch {
          /* skip malformed JSON */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return terminal;
}

export function useScheduleRunStream(
  runId: string | undefined,
  enabled: boolean,
  handlers: StreamHandlers,
): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!runId || !enabled) {
      setStatus('idle');
      return;
    }

    let alive = true;
    let ctrl: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;

    function go() {
      if (!alive) return;
      const token = getAccessToken();
      if (!token) {
        setStatus('failed');
        return;
      }

      ctrl = new AbortController();
      if (retries === 0) setStatus('connecting');

      consumeStream(`/api/v1/schedule-runs/${runId}/stream`, token, ctrl.signal, {
        open() {
          if (!alive) return;
          if (retries > 0) ref.current.onReconnected();
          retries = 0;
          setStatus('connected');
        },
        progress(d) { if (alive) ref.current.onProgress(d); },
        state(d) { if (alive) ref.current.onState(d); },
        error(d) { if (alive) ref.current.onError(d); },
      })
        .then((terminal) => {
          if (alive && !terminal) retry();
        })
        .catch(() => {
          if (alive && !ctrl?.signal.aborted) retry();
        });
    }

    function retry() {
      if (!alive) return;
      retries += 1;
      if (retries > MAX_RETRIES) {
        setStatus('failed');
        return;
      }
      setStatus('reconnecting');
      timer = setTimeout(go, backoffDelay(retries - 1));
    }

    go();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      ctrl?.abort();
    };
  }, [runId, enabled]);

  return status;
}
