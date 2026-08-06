/**
 * Localhost (Surfpool) preflight before deposit / preview / redeem / NAV.
 *
 * 1. Refresh synthetic Pyth feeds (StaleOracle)
 * 2. Advance Whirlpool clock if needed (InvalidTimestamp)
 *
 * No-op on mainnet. DEX-priced assets read live pool spot directly (no
 * on-chain TWAP or keeper as of 2.0.2), so no separate freshness step is
 * needed for them here.
 */

import type { Connection, PublicKey } from '@solana/web3.js';
import type { Network } from '../constants';
import { ensureFreshPythFeeds, type PythRefreshAsset } from './pyth';
import { ensureWhirlpoolClock, type WhirlpoolClockAsset } from './whirlpool-clock';

export type ProgressFn = (msg: string) => void;

export interface LocalhostPreflightCtx {
  assets: Array<PythRefreshAsset & WhirlpoolClockAsset>;
  usdcSolPool?: PublicKey | null;
}

export interface LocalhostPreflightResult {
  pyth?: Awaited<ReturnType<typeof ensureFreshPythFeeds>>;
  clock?: Awaited<ReturnType<typeof ensureWhirlpoolClock>>;
}

/**
 * Run Surfpool-only oracle + clock prep. Throws if Pyth refresh fails or a
 * required feed was skipped (would hit StaleOracle on-chain).
 */
export async function ensureLocalhostSwapPreflight(
  connection: Connection,
  network: Network,
  ctx: LocalhostPreflightCtx,
  onProgress?: ProgressFn,
): Promise<LocalhostPreflightResult> {
  if (network !== 'localhost') return {};

  onProgress?.('Refreshing Pyth feeds (Surfpool)…');
  const pyth = await ensureFreshPythFeeds(connection, { assets: ctx.assets });
  if (!pyth.ok) {
    throw new Error(
      `Pyth refresh failed (StaleOracle risk): ${pyth.reason || 'unknown'}`,
    );
  }
  onProgress?.(
    `Pyth OK — SOL ≈ $${Number(pyth.solUsd).toFixed(2)}; refreshed ${pyth.refreshed.length}` +
      (pyth.skipped?.length ? `; skipped ${pyth.skipped.length}` : ''),
  );
  if (pyth.skipped?.length) {
    throw new Error(
      `Could not refresh Pyth feed(s) for vault assets: ${pyth.skipped.join('; ')}. ` +
        `Swap would fail with StaleOracle (6011).`,
    );
  }

  onProgress?.('Checking Whirlpool pool clocks (Surfpool)…');
  const clock = await ensureWhirlpoolClock(connection, {
    assets: ctx.assets,
    usdcSolPool: ctx.usdcSolPool,
  });
  if (!clock.ok) {
    throw new Error(
      `Whirlpool clock sync failed: ${clock.reason || 'unknown'}. ` +
        `Swaps may fail with Whirlpool InvalidTimestamp (0x1786).`,
    );
  }
  if (clock.advanced) {
    onProgress?.(
      `Surfpool clock advanced past pool reward ts (was ${clock.fromTs}, pool max ${clock.maxPoolTs})`,
    );
  } else {
    onProgress?.(
      `Whirlpool clock OK (block ${clock.fromTs} ≥ pool max ${clock.maxPoolTs ?? 0})`,
    );
  }

  return { pyth, clock };
}
