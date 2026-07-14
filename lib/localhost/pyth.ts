/**
 * Synthetic Pyth PriceUpdateV2 refresh for Surfpool (localhost).
 *
 * Mainnet-cloned PriceUpdateV2 accounts go stale within PYTH_MAX_AGE_SECS (~60s).
 * NAV / preview / deposit then fail with StaleOracle (6011 / 0x177b).
 *
 * On Surfpool we rewrite each vault Pyth feed via surfnet_setAccount with a
 * fresh publish_time. Mirrors c_vault_script/lib/pyth.js.
 */

import { Buffer } from 'buffer';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  SOL_USD_PYTH_FEED_ID_HEX,
  SOL_USD_PYTH_FEED_ID,
  WSOL_MINT,
  WSOL_USDC_POOL,
  WSOL_DECIMALS,
  USDC_DECIMALS,
  USDC_MINT_MAINNET,
  PRICE_SOURCE_PYTH,
  PRICE_SOURCE_DEX,
  PYTH_PUSH_ORACLE_PROGRAM_ID,
} from '../constants';
import { fetchPoolCtx } from '../whirlpool';
import { isSurfnetFail, surfnetRpc } from './surfnet';

/** PDA [shard 0 (u16 LE), feed_id] on the Pyth push-oracle program. */
function pythFeedAccount(pythFeedId: number[] | Uint8Array): PublicKey {
  const shard = Buffer.alloc(2);
  const [pda] = PublicKey.findProgramAddressSync(
    [shard, Buffer.from(pythFeedId)],
    PYTH_PUSH_ORACLE_PROGRAM_ID,
  );
  return pda;
}

/** Pyth Receiver program that owns PriceUpdateV2 accounts. */
export const PYTH_RECEIVER_PROGRAM_ID = new PublicKey(
  'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ',
);

const USDC_MINT = USDC_MINT_MAINNET;

/** Exponent used by our synthetic mantissas (price * 1e8). */
const PYTH_EXPO = -8;

// sha256("account:PriceUpdateV2")[0..8]
const PRICE_UPDATE_V2_DISCRIMINATOR = Buffer.from([
  34, 241, 35, 99, 157, 126, 244, 205,
]);

export interface PythRefreshAsset {
  priceSourceTag: number;
  pythFeedId: number[] | Uint8Array;
  route?: string;
  mint?: PublicKey;
  poolAddress?: PublicKey;
  decimals?: number;
}

export interface PythRefreshResult {
  ok: boolean;
  solUsd?: number;
  refreshed: string[];
  skipped: string[];
  reason?: string;
}

/** Price of token A in units of token B from a Whirlpool sqrt price. */
export function sqrtPriceToUi(sqrtPrice: bigint, decimalsA: number, decimalsB: number): number {
  const sqrtF = Number(sqrtPrice) / 2 ** 64;
  const priceRaw = sqrtF * sqrtF;
  return priceRaw * 10 ** (decimalsA - decimalsB);
}

export function buildPriceUpdateV2Data(
  feedIdHex: string,
  priceMantissa: bigint,
  exponent: number,
  publishTime: number,
  postedSlot: number,
): Buffer {
  const buf = Buffer.alloc(133);
  let o = 0;
  PRICE_UPDATE_V2_DISCRIMINATOR.copy(buf, o);
  o += 8;
  o += 32; // write_authority — zeros
  buf.writeUInt8(1, o); // VerificationLevel::Full
  o += 1;
  Buffer.from(feedIdHex, 'hex').copy(buf, o);
  o += 32;
  buf.writeBigInt64LE(priceMantissa, o);
  o += 8;
  buf.writeBigUInt64LE(priceMantissa / 100n, o); // conf ≈ 1%
  o += 8;
  buf.writeInt32LE(exponent, o);
  o += 4;
  buf.writeBigInt64LE(BigInt(publishTime), o);
  o += 8;
  buf.writeBigInt64LE(BigInt(publishTime - 1), o);
  o += 8;
  buf.writeBigInt64LE(priceMantissa, o); // ema_price
  o += 8;
  buf.writeBigUInt64LE(priceMantissa / 100n, o);
  o += 8;
  buf.writeBigUInt64LE(BigInt(postedSlot), o);
  return buf;
}

/** SOL UI price from the canonical WSOL/USDC Whirlpool. */
export async function solUiPriceFromPool(connection: Connection): Promise<number> {
  const pool = await fetchPoolCtx(connection, WSOL_USDC_POOL);
  if (pool.info.tokenMintA.equals(WSOL_MINT)) {
    return sqrtPriceToUi(pool.info.sqrtPrice, WSOL_DECIMALS, USDC_DECIMALS);
  }
  return 1 / sqrtPriceToUi(pool.info.sqrtPrice, USDC_DECIMALS, WSOL_DECIMALS);
}

async function assetUsdFromPool(
  connection: Connection,
  poolAddress: PublicKey,
  assetMint: PublicKey,
  assetDecimals: number,
  solUsd: number,
): Promise<number | null> {
  let pool;
  try {
    pool = await fetchPoolCtx(connection, poolAddress);
  } catch {
    return null;
  }
  const { tokenMintA, tokenMintB, sqrtPrice } = pool.info;

  if (tokenMintA.equals(USDC_MINT) && tokenMintB.equals(assetMint)) {
    return 1 / sqrtPriceToUi(sqrtPrice, USDC_DECIMALS, assetDecimals);
  }
  if (tokenMintB.equals(USDC_MINT) && tokenMintA.equals(assetMint)) {
    return sqrtPriceToUi(sqrtPrice, assetDecimals, USDC_DECIMALS);
  }

  if (tokenMintA.equals(WSOL_MINT) && tokenMintB.equals(assetMint)) {
    const assetPerSol = sqrtPriceToUi(sqrtPrice, WSOL_DECIMALS, assetDecimals);
    if (!Number.isFinite(assetPerSol) || assetPerSol <= 0) return null;
    return solUsd / assetPerSol;
  }
  if (tokenMintB.equals(WSOL_MINT) && tokenMintA.equals(assetMint)) {
    const solPerAsset = sqrtPriceToUi(sqrtPrice, assetDecimals, WSOL_DECIMALS);
    if (!Number.isFinite(solPerAsset) || solPerAsset <= 0) return null;
    return solUsd * solPerAsset;
  }

  return null;
}

async function readExistingMantissa(
  connection: Connection,
  feedAddress: PublicKey,
): Promise<{ mantissa: bigint; exponent: number } | null> {
  const info = await connection.getAccountInfo(feedAddress);
  if (!info?.data || info.data.length < 85) return null;
  const data = Buffer.from(info.data);
  const mantissa = data.readBigInt64LE(73);
  const exponent = data.readInt32LE(73 + 8 + 8);
  if (mantissa <= 0n) return null;
  return { mantissa, exponent };
}

export async function setPythFeed(
  connection: Connection,
  feedAddress: PublicKey,
  feedIdHex: string,
  priceMantissa: bigint,
  exponent: number,
  publishTime: number,
  postedSlot: number,
): Promise<boolean> {
  const data = buildPriceUpdateV2Data(
    feedIdHex,
    priceMantissa,
    exponent,
    publishTime,
    postedSlot,
  );
  const result = await surfnetRpc(connection, 'surfnet_setAccount', [
    feedAddress.toBase58(),
    {
      lamports: 10_000_000,
      data: data.toString('hex'),
      owner: PYTH_RECEIVER_PROGRAM_ID.toBase58(),
      executable: false,
    },
  ]);
  if (isSurfnetFail(result)) return false;
  return true;
}

/**
 * Refresh SOL/USD and every vault Pyth feed so NAV/deposit/redeem work on Surfpool.
 */
export async function ensureFreshPythFeeds(
  connection: Connection,
  opts: { assets?: PythRefreshAsset[]; force?: boolean } = {},
): Promise<PythRefreshResult> {
  const slot = await connection.getSlot();
  let publishTime = await connection.getBlockTime(slot);
  if (publishTime == null) publishTime = Math.floor(Date.now() / 1000);
  publishTime = Math.max(publishTime, Math.floor(Date.now() / 1000));

  let solUi: number;
  try {
    solUi = await solUiPriceFromPool(connection);
  } catch (e) {
    return {
      ok: false,
      refreshed: [],
      skipped: [],
      reason: `Could not read WSOL/USDC pool for oracle price: ${e instanceof Error ? e.message : e}`,
    };
  }
  if (!Number.isFinite(solUi) || solUi <= 0) {
    return {
      ok: false,
      refreshed: [],
      skipped: [],
      reason: `Invalid SOL UI price: ${solUi}`,
    };
  }

  const solMantissa = BigInt(Math.round(solUi * 1e8));

  type Target = {
    address: PublicKey;
    feedIdHex: string;
    mantissa: bigint;
    exponent: number;
    label: string;
  };
  const targets = new Map<string, Target>();

  const solFeed = pythFeedAccount(SOL_USD_PYTH_FEED_ID);
  targets.set(solFeed.toBase58(), {
    address: solFeed,
    feedIdHex: SOL_USD_PYTH_FEED_ID_HEX,
    mantissa: solMantissa,
    exponent: PYTH_EXPO,
    label: 'SOL/USD',
  });

  const skipped: string[] = [];

  for (const asset of opts.assets || []) {
    if (asset.priceSourceTag === PRICE_SOURCE_DEX) continue;
    if (asset.priceSourceTag != null && asset.priceSourceTag !== PRICE_SOURCE_PYTH) {
      continue;
    }

    const bytes = asset.pythFeedId;
    if (!bytes || !Array.from(bytes).some((b) => b !== 0)) continue;

    const feedIdHex = Buffer.from(bytes).toString('hex');
    const address = pythFeedAccount(bytes);
    const key = address.toBase58();
    if (targets.has(key)) continue;

    let uiUsd: number | null = null;
    if (feedIdHex === SOL_USD_PYTH_FEED_ID_HEX) {
      uiUsd = solUi;
    } else if (asset.mint && asset.poolAddress && asset.decimals != null) {
      uiUsd = await assetUsdFromPool(
        connection,
        asset.poolAddress,
        asset.mint,
        asset.decimals,
        solUi,
      );
    }

    if (uiUsd != null && Number.isFinite(uiUsd) && uiUsd > 0) {
      targets.set(key, {
        address,
        feedIdHex,
        mantissa: BigInt(Math.round(uiUsd * 1e8)),
        exponent: PYTH_EXPO,
        label: feedIdHex.slice(0, 8),
      });
      continue;
    }

    const existing = await readExistingMantissa(connection, address);
    if (existing) {
      targets.set(key, {
        address,
        feedIdHex,
        mantissa: existing.mantissa,
        exponent: existing.exponent,
        label: `${feedIdHex.slice(0, 8)} (restamp)`,
      });
      continue;
    }

    skipped.push(
      `${feedIdHex.slice(0, 12)}… (no pool price + no existing feed account)`,
    );
  }

  const refreshed: string[] = [];
  let anyFail = false;
  for (const t of targets.values()) {
    const ok = await setPythFeed(
      connection,
      t.address,
      t.feedIdHex,
      t.mantissa,
      t.exponent,
      publishTime,
      slot,
    );
    if (ok) refreshed.push(`${t.label}:${t.address.toBase58().slice(0, 8)}…`);
    else anyFail = true;
  }

  if (anyFail && refreshed.length === 0) {
    return {
      ok: false,
      refreshed: [],
      skipped,
      reason:
        'surfnet_setAccount unavailable — refresh Pyth feeds only works on Surfpool, not plain test-validator/mainnet RPC',
    };
  }

  if (skipped.length > 0 && refreshed.length > 0) {
    return {
      ok: true,
      solUsd: solUi,
      refreshed,
      skipped,
      reason: `Some feeds not refreshed: ${skipped.join('; ')}`,
    };
  }

  return {
    ok: true,
    solUsd: solUi,
    refreshed,
    skipped,
  };
}
