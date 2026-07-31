import { Connection, PublicKey } from '@solana/web3.js';
import {
  experimental_upgradeWebSocket,
  type WebSocketData,
} from '@vercel/functions';
import {
  fetchVaultCtx,
  getTotalNavViewWithCtx,
  resolveNavViewCtx,
  type NavViewCtx,
} from '@/lib/cvault';
// fetchPoolCtx lives in whirlpool.ts — cvault imports it but does not re-export.
import { fetchPoolCtx } from '@/lib/whirlpool';
import { resolveWatchAccounts } from '@/lib/realtime/watch-accounts';
import { createNavRoom, type NavRoom, type RoomDeps } from '@/lib/realtime/nav-room';
import { parseClientCommand, type NavStreamMessage } from '@/lib/realtime/types';

/** Whirlpool pricing reads the two token vaults; `priceDexKind === 0`. */
const DEX_KIND_WHIRLPOOL = 0;

/**
 * Rooms are per-function-instance. Vercel gives no instance affinity, so two
 * viewers of the same vault may land on different instances and each hold
 * their own subscriptions. For public price data that is duplicated work, not
 * incorrect data — both compute the same NAV from the same chain state.
 */
const rooms = new Map<number, NavRoom>();

function httpUrl(): string {
  const url = process.env.NEXT_PUBLIC_HELIUS_RPC;
  if (!url) throw new Error('NEXT_PUBLIC_HELIUS_RPC is not set');
  return url;
}

function wssUrl(): string {
  const url = process.env.HELIUS_WSS_RPC;
  if (!url) throw new Error('HELIUS_WSS_RPC is not set');
  return url;
}

function buildDeps(vaultId: number): RoomDeps {
  const connection = new Connection(httpUrl(), {
    commitment: 'confirmed',
    wsEndpoint: wssUrl(),
  });

  let cached: NavViewCtx | null = null;
  const resolved = async (): Promise<NavViewCtx> => {
    if (!cached) cached = await resolveNavViewCtx(connection, vaultId, 'mainnet');
    return cached;
  };

  return {
    vaultAccountKey: async () => {
      const ctx = await fetchVaultCtx(connection, vaultId, 'mainnet');
      return ctx.vaultPda.toBase58();
    },

    watchAccounts: async () => {
      cached = null; // force re-resolution — the basket may have changed
      const { ctx } = await resolved();

      // Whirlpool assets price off their two token vaults; pre-fetch so
      // resolveWatchAccounts stays pure.
      const whirlpoolVaults = new Map<string, [PublicKey, PublicKey]>();
      for (const asset of ctx.assets.slice(0, ctx.numAssets)) {
        if (asset.priceDexKind !== DEX_KIND_WHIRLPOOL) continue;
        try {
          const pool = await fetchPoolCtx(connection, asset.pricePoolAddress);
          whirlpoolVaults.set(asset.pricePoolAddress.toBase58(), [
            pool.info.tokenVaultA,
            pool.info.tokenVaultB,
          ]);
        } catch {
          // Fall back to watching the pool alone — a coarser trigger, but
          // never a missed recompute.
        }
      }
      return resolveWatchAccounts(ctx, whirlpoolVaults).map((k) => k.toBase58());
    },

    subscribe: (keys, onChange) => {
      const ids = keys.map((key) =>
        connection.onAccountChange(new PublicKey(key), () => onChange(key), 'confirmed'),
      );
      return () => {
        for (const id of ids) {
          void connection.removeAccountChangeListener(id);
        }
      };
    },

    computePrice: async () => {
      const ctxs = await resolved();
      const nav = await getTotalNavViewWithCtx(connection, ctxs, vaultId);
      const slot = await connection.getSlot('confirmed').catch(() => 0);
      return {
        sharePriceUsd: nav.sharePriceUsd,
        totalNavUsd: nav.totalNavUsd,
        totalSharesUi: nav.totalSharesUi,
        sharePrice: nav.sharePrice,
        totalNav: nav.totalNav,
        slot,
        ...(nav.note ? { note: nav.note } : {}),
      };
    },
  };
}

function roomFor(vaultId: number): NavRoom {
  let room = rooms.get(vaultId);
  if (!room) {
    room = createNavRoom(vaultId, buildDeps(vaultId));
    rooms.set(vaultId, room);
  }
  return room;
}

export async function GET() {
  return experimental_upgradeWebSocket((ws) => {
    let leave: (() => void) | null = null;

    const send = (message: NavStreamMessage) => {
      // readyState 1 === OPEN
      if (ws.readyState === 1) ws.send(JSON.stringify(message));
    };

    ws.on('message', (data: WebSocketData) => {
      // One subscription per socket — a second subscribe is ignored.
      if (leave) return;

      const command = parseClientCommand(String(data));
      if (!command) {
        send({ type: 'error', vaultId: -1, message: 'Invalid subscribe command' });
        ws.close();
        return;
      }

      try {
        leave = roomFor(command.vaultId).join(send);
      } catch (err) {
        send({
          type: 'error',
          vaultId: command.vaultId,
          message: err instanceof Error ? err.message : String(err),
        });
        ws.close();
      }
    });

    ws.on('close', () => {
      leave?.();
      leave = null;
    });

    ws.on('error', () => {
      leave?.();
      leave = null;
    });
  });
}
