'use client';

import { useEffect, useRef, useState } from 'react';
import type { NavPricePayload, NavStreamMessage } from '@/lib/realtime/types';

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

/** Exponential backoff, capped. Exported for test. */
export function nextBackoff(current: number): number {
  return Math.min(current * 2, MAX_BACKOFF_MS);
}

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'error';

export interface VaultPriceState {
  price: NavPricePayload | null;
  status: StreamStatus;
  error: string | null;
}

/**
 * Live vault price over the server's WebSocket room.
 *
 * Vercel closes function WebSockets at max duration, so disconnects are
 * routine, not exceptional: reconnect with backoff, resubscribe, and the
 * server replies with a fresh snapshot. The last known price stays on screen
 * throughout, so the user sees no gap.
 */
export function useVaultPrice(vaultId: number | null): VaultPriceState {
  const [price, setPrice] = useState<NavPricePayload | null>(null);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (vaultId === null) return;

    let closed = false;
    let backoff = INITIAL_BACKOFF_MS;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;

      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${proto}://${window.location.host}/api/vaults/stream`);
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        backoff = INITIAL_BACKOFF_MS;
        setStatus('live');
        setError(null);
        socket.send(JSON.stringify({ type: 'subscribe', vaultId }));
      });

      socket.addEventListener('message', (event) => {
        let message: NavStreamMessage;
        try {
          message = JSON.parse(String(event.data)) as NavStreamMessage;
        } catch {
          return; // ignore an unparseable frame rather than tearing down
        }
        if (message.type === 'error') {
          setError(message.message);
          setStatus('error');
          return;
        }
        if (message.type === 'snapshot' || message.type === 'update') {
          setPrice({
            vaultId: message.vaultId,
            sharePriceUsd: message.sharePriceUsd,
            totalNavUsd: message.totalNavUsd,
            totalSharesUi: message.totalSharesUi,
            sharePrice: message.sharePrice,
            totalNav: message.totalNav,
            slot: message.slot,
            ts: message.ts,
            stale: message.stale,
            ...(message.note ? { note: message.note } : {}),
          });
          setStatus('live');
        }
      });

      socket.addEventListener('close', () => {
        if (closed) return;
        // Expected at function max duration — keep the last price on screen.
        setStatus('reconnecting');
        retryTimer = setTimeout(connect, backoff);
        backoff = nextBackoff(backoff);
      });

      socket.addEventListener('error', () => socket.close());
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [vaultId]);

  return { price, status, error };
}
