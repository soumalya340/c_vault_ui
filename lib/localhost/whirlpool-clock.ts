/**
 * Surfpool Whirlpool clock sync — avoids InvalidTimestamp (0x1786 / 6022).
 * Mirrors c_vault_script/lib/whirlpool.js `ensureWhirlpoolClock`.
 */

import { Buffer } from 'buffer';
import { Connection, PublicKey } from '@solana/web3.js';
import { WHIRLPOOL_PROGRAM_ID } from '../constants';
import { isSurfnetFail, surfnetRpc } from './surfnet';

/** Offset of `reward_last_updated_timestamp` in the Whirlpool account. */
export const WHIRLPOOL_REWARD_TS_OFFSET = 261;

export interface WhirlpoolClockAsset {
  poolAddress?: PublicKey | null;
  swapKind?: string;
}

export interface WhirlpoolClockResult {
  ok: boolean;
  advanced: boolean;
  fromTs?: number;
  toTs?: number;
  maxPoolTs?: number;
  reason?: string;
}

/**
 * If any vault Whirlpool's `reward_last_updated_timestamp` is ahead of the
 * validator clock, advance the clock past it via `surfnet_timeTravel`.
 */
export async function ensureWhirlpoolClock(
  connection: Connection,
  ctx: {
    assets?: WhirlpoolClockAsset[];
    usdcSolPool?: PublicKey | null;
  } = {},
): Promise<WhirlpoolClockResult> {
  const pools = new Map<string, PublicKey>();
  if (ctx.usdcSolPool) pools.set(ctx.usdcSolPool.toBase58(), ctx.usdcSolPool);
  for (const a of ctx.assets || []) {
    if (!a?.poolAddress) continue;
    if (a.swapKind && a.swapKind !== 'Whirlpool') continue;
    pools.set(a.poolAddress.toBase58(), a.poolAddress);
  }

  let maxPoolTs = 0;
  for (const pool of pools.values()) {
    try {
      const info = await connection.getAccountInfo(pool);
      if (!info?.data || info.data.length < WHIRLPOOL_REWARD_TS_OFFSET + 8) continue;
      if (!info.owner.equals(WHIRLPOOL_PROGRAM_ID)) continue;
      const data = Buffer.from(info.data);
      const ts = Number(data.readBigUInt64LE(WHIRLPOOL_REWARD_TS_OFFSET));
      if (ts > maxPoolTs) maxPoolTs = ts;
    } catch {
      // skip unreadable pools
    }
  }

  const slot = await connection.getSlot();
  let blockTime = await connection.getBlockTime(slot);
  if (blockTime == null) blockTime = Math.floor(Date.now() / 1000);
  const wall = Math.floor(Date.now() / 1000);
  const effectiveNow = Math.max(blockTime, wall);

  if (blockTime >= maxPoolTs) {
    return { ok: true, advanced: false, fromTs: blockTime, maxPoolTs };
  }

  const targetTs = Math.max(maxPoolTs + 3600, effectiveNow);
  const deltaSec = targetTs - blockTime;
  const deltaSlots = Math.max(1, Math.ceil(deltaSec / 0.4));
  const result = await surfnetRpc(connection, 'surfnet_timeTravel', [
    { absoluteSlot: slot + deltaSlots },
  ]);
  if (isSurfnetFail(result)) {
    const err = result.error;
    return {
      ok: false,
      advanced: false,
      fromTs: blockTime,
      maxPoolTs,
      reason:
        err instanceof Error
          ? err.message
          : 'surfnet_timeTravel failed — Whirlpool swaps may hit InvalidTimestamp (0x1786)',
    };
  }

  return {
    ok: true,
    advanced: true,
    fromTs: blockTime,
    toTs: targetTs,
    maxPoolTs,
  };
}
