/**
 * Spot price → Q64.64 for DEX-TWAP keeper updates.
 *
 * Uses Orca Whirlpool or Meteora DAMM v2 pool sqrt price only (not on-chain TWAP).
 * Unit: raw USDC (6 dec) per raw asset unit, Q64.64 — then downshifted to Q32.32
 * for the on-chain `update_dex_twap(twap_live_state: u64)` arg.
 */

import BN from 'bn.js';
import Decimal from 'decimal.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import {
  USDC_MINT_MAINNET,
  USDC_DECIMALS,
  WSOL_MINT,
  WSOL_USDC_POOL,
  WSOL_DECIMALS,
} from '../constants';
import { fetchPoolCtx } from '../whirlpool';
import { solUiPriceFromPool } from '../localhost/pyth';

const Q64 = new BN(2).pow(new BN(64));
const USDC_MINT = USDC_MINT_MAINNET;

export function mulQ64(a: BN, b: BN): BN {
  return a.mul(b).shrn(64);
}

export function invQ64(x: BN): BN {
  if (x.isZero()) throw new Error('invQ64: zero');
  return new BN(1).shln(128).div(x);
}

/** Q64.64 → Q32.32 (u64-width) for `update_dex_twap` arg. */
export function toQ32_32(priceX64: BN): BN {
  return priceX64.shrn(32);
}

export function priceAssetInQuoteX64(args: {
  sqrtPriceX64: BN;
  mintA: PublicKey;
  mintB: PublicKey;
  assetMint: PublicKey;
  quoteMint: PublicKey;
}): BN {
  const { sqrtPriceX64, mintA, mintB, assetMint, quoteMint } = args;
  let assetIsA: boolean;
  if (mintA.equals(assetMint) && mintB.equals(quoteMint)) assetIsA = true;
  else if (mintB.equals(assetMint) && mintA.equals(quoteMint)) assetIsA = false;
  else {
    throw new Error(
      `Pool mints ${mintA.toBase58()}/${mintB.toBase58()} do not match asset ${assetMint.toBase58()} quote ${quoteMint.toBase58()}`,
    );
  }
  const priceAInB = mulQ64(sqrtPriceX64, sqrtPriceX64);
  return assetIsA ? priceAInB : invQ64(priceAInB);
}

/** Mirror script: usdc_raw/asset_raw x64 from SOL-quoted price + SOL/USD UI. */
export function solQuotePriceToUsdcX64(priceAssetInSolX64: BN, solUsdUi: number): BN {
  if (!(solUsdUi > 0) || !Number.isFinite(solUsdUi)) {
    throw new Error(`Invalid solUsdUi: ${solUsdUi}`);
  }
  const solScaled = new BN(new Decimal(solUsdUi).mul(1e9).toFixed(0));
  const num = priceAssetInSolX64.mul(solScaled).mul(new BN(1_000_000));
  const den = new BN(1_000_000_000).mul(new BN(1_000_000_000));
  return num.div(den);
}

export async function fetchWhirlpoolSqrtPriceX64(
  connection: Connection,
  poolPk: PublicKey,
): Promise<{ sqrtPriceX64: BN; mintA: PublicKey; mintB: PublicKey }> {
  const pool = await fetchPoolCtx(connection, poolPk);
  return {
    sqrtPriceX64: new BN(pool.info.sqrtPrice.toString()),
    mintA: pool.info.tokenMintA,
    mintB: pool.info.tokenMintB,
  };
}

export async function fetchDammSqrtPriceX64(
  connection: Connection,
  poolPk: PublicKey,
): Promise<{ sqrtPriceX64: BN; mintA: PublicKey; mintB: PublicKey }> {
  const cpAmm = new CpAmm(connection);
  const state = await cpAmm.fetchPoolState(poolPk);
  return {
    sqrtPriceX64: new BN(state.sqrtPrice.toString()),
    mintA: state.tokenAMint,
    mintB: state.tokenBMint,
  };
}

export type SpotAssetInput = {
  mint: PublicKey;
  priceDexKind: number;
  pricePoolAddress: PublicKey;
  route: 'ViaSol' | 'DirectUsdc' | string;
  decimals: number;
};

export type SpotPriceResult = {
  priceX64: BN;
  uiUsdEstimate: number;
  dexLabel: 'Whirlpool' | 'DammV2';
  pool: string;
};

/**
 * Live pool spot for one DEX-priced asset (Orca or DAMM v2 only).
 * priceDexKind: 0 = Whirlpool, 1 = DammV2.
 */
export async function computeSpotPriceX64(
  connection: Connection,
  asset: SpotAssetInput,
): Promise<SpotPriceResult> {
  const priceDexKind = Number(asset.priceDexKind ?? 0);
  const pool = asset.pricePoolAddress;
  const mint = asset.mint instanceof PublicKey ? asset.mint : new PublicKey(asset.mint);
  const route = asset.route;
  const dexLabel: 'Whirlpool' | 'DammV2' = priceDexKind === 1 ? 'DammV2' : 'Whirlpool';

  const snap =
    priceDexKind === 1
      ? await fetchDammSqrtPriceX64(connection, pool)
      : await fetchWhirlpoolSqrtPriceX64(connection, pool);

  const quoteMint = route === 'ViaSol' || route === 'viaSol' ? WSOL_MINT : USDC_MINT;
  let priceX64 = priceAssetInQuoteX64({
    sqrtPriceX64: snap.sqrtPriceX64,
    mintA: snap.mintA,
    mintB: snap.mintB,
    assetMint: mint,
    quoteMint,
  });

  if (route === 'ViaSol' || route === 'viaSol') {
    const solUsd = await solUiPriceFromPool(connection);
    if (mint.equals(WSOL_MINT)) {
      priceX64 = solQuotePriceToUsdcX64(Q64, solUsd);
    } else {
      priceX64 = solQuotePriceToUsdcX64(priceX64, solUsd);
    }
  }

  const decimals = Number(asset.decimals ?? 0);
  const uiUsdEstimate = new Decimal(priceX64.toString())
    .div(new Decimal(2).pow(64))
    .mul(new Decimal(10).pow(decimals - USDC_DECIMALS))
    .toNumber();

  return {
    priceX64,
    uiUsdEstimate,
    dexLabel,
    pool: pool.toBase58(),
  };
}

/** Exported for tests / debug — canonical SOL pool used by ViaSol conversion. */
export { WSOL_USDC_POOL, WSOL_DECIMALS };
