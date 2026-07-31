import type { NavPricePayload, NavStreamMessage } from './types';

/** Coalesce window for triggers landing in the same slot. */
const DEBOUNCE_MS = 150;

/** The price fields the room needs; a subset of `NavView` plus the slot. */
export type ComputedPrice = Pick<
  NavPricePayload,
  'sharePriceUsd' | 'totalNavUsd' | 'totalSharesUi' | 'sharePrice' | 'totalNav' | 'slot'
> & { note?: string };

/**
 * Every RPC boundary the room touches, injected so the room is testable
 * without a validator or a live Helius socket.
 */
export interface RoomDeps {
  /** Accounts whose change can move NAV. Re-called when the vault changes. */
  watchAccounts: () => Promise<string[]>;
  /** Open account subscriptions; returns an unsubscribe function. */
  subscribe: (keys: string[], onChange: (accountKey: string) => void) => () => void;
  /** Run the on-chain NAV view. */
  computePrice: () => Promise<ComputedPrice>;
  /** The vault account address — a change here invalidates cached context. */
  vaultAccountKey: () => Promise<string>;
}

export type Send = (message: NavStreamMessage) => void;

export interface NavRoom {
  /** Add a client. Returns its leave function. */
  join: (send: Send) => () => void;
  size: () => number;
}

/**
 * One room per vault. Reference-counted: the first client opens subscriptions,
 * the last one closes them. State is in-memory and per-instance, which is safe
 * because it is entirely derived from chain state and rebuilt on reconnect.
 */
export function createNavRoom(vaultId: number, deps: RoomDeps): NavRoom {
  const clients = new Set<Send>();
  let unsubscribe: (() => void) | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let last: NavPricePayload | null = null;
  let vaultKey: string | null = null;
  let recomputing = false;

  const broadcast = (message: NavStreamMessage) => {
    for (const send of clients) {
      try {
        send(message);
      } catch {
        // A dead socket is removed by its own close handler; never let one
        // bad client break the broadcast for the rest of the room.
      }
    }
  };

  const toPayload = (price: ComputedPrice, stale: boolean): NavPricePayload => ({
    vaultId,
    sharePriceUsd: price.sharePriceUsd,
    totalNavUsd: price.totalNavUsd,
    totalSharesUi: price.totalSharesUi,
    sharePrice: price.sharePrice,
    totalNav: price.totalNav,
    slot: price.slot,
    ts: Date.now(),
    stale,
    ...(price.note ? { note: price.note } : {}),
  });

  const changed = (next: NavPricePayload): boolean =>
    last === null ||
    last.sharePrice !== next.sharePrice ||
    last.totalNav !== next.totalNav;

  async function recompute(kind: 'snapshot' | 'update'): Promise<void> {
    if (recomputing) return;
    recomputing = true;
    try {
      const price = await deps.computePrice();
      const payload = toPayload(price, false);
      if (kind === 'snapshot') {
        last = payload;
        broadcast({ type: 'snapshot', ...payload });
      } else if (changed(payload)) {
        last = payload;
        broadcast({ type: 'update', ...payload });
      }
    } catch (err) {
      // Never broadcast a wrong price — re-send the last good one as stale.
      if (last) {
        last = { ...last, stale: true, ts: Date.now() };
        broadcast({ type: 'update', ...last });
      } else {
        broadcast({
          type: 'error',
          vaultId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      recomputing = false;
    }
  }

  async function openSubscriptions(): Promise<void> {
    vaultKey = await deps.vaultAccountKey();
    const keys = await deps.watchAccounts();
    unsubscribe = deps.subscribe(keys, onAccountChange);
  }

  function onAccountChange(accountKey: string): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      // A vault-account change can alter the basket (rebalance), so the
      // cached account set is no longer trustworthy — rebuild it.
      if (accountKey === vaultKey) {
        void reopenThenRecompute();
      } else {
        void recompute('update');
      }
    }, DEBOUNCE_MS);
  }

  async function reopenThenRecompute(): Promise<void> {
    try {
      unsubscribe?.();
      unsubscribe = null;
      await openSubscriptions();
    } catch {
      // Keep serving the last good price; the next trigger retries.
    }
    await recompute('update');
  }

  async function start(): Promise<void> {
    try {
      await openSubscriptions();
      await recompute('snapshot');
    } catch (err) {
      broadcast({
        type: 'error',
        vaultId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function stop(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    unsubscribe?.();
    unsubscribe = null;
    last = null;
    vaultKey = null;
  }

  return {
    join(send: Send): () => void {
      const isFirst = clients.size === 0;
      clients.add(send);

      if (isFirst) {
        void start();
      } else if (last) {
        // Late joiner gets the cached value immediately — no extra RPC.
        send({ type: 'snapshot', ...last });
      }

      let left = false;
      return () => {
        if (left) return; // idempotent — close can fire more than once
        left = true;
        clients.delete(send);
        if (clients.size === 0) stop();
      };
    },
    size: () => clients.size,
  };
}
