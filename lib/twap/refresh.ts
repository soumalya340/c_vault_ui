/**
 * Vault-scoped DEX TWAP freshness before deposit / redeem / genesis.
 *
 * Vault max is 9 assets — we only inspect the basket, keep DEX-priced rows,
 * and for stale observations push **pool spot** (Orca or DAMM v2 SDK) via
 * `update_dex_twap`.
 *
 * **Single transaction, multi-instruction:** every stale asset becomes its own
 * small `update_dex_twap` ix (4 accounts each; shared payer/keeper/global).
 * All ixs are packed into **one** v0 message — never one tx per asset.
 * Worst case 9 ixs + compute-budget still fits without an ALT.
 * Signers: depositor (fee payer) once + keeper cosign once.
 */

import BN from 'bn.js';
import { PublicKey, type Connection } from '@solana/web3.js';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import type { Program } from '@coral-xyz/anchor';
import {
  PRICE_SOURCE_DEX,
  TWAP_KEEPER_PUBKEY,
  TWAP_KEEPER_MAX_STALE_SECS,
  TWAP_OBSERVATION_MAX_STALE_SECS,
} from '../constants';
import { deriveAssetInfoPda, deriveGlobalStatePda } from '../pda';
import { computeSpotPriceX64, toQ32_32 } from './spot';
import { isObservationStale } from './staleness';
import { sendV0WithTwapKeeperCosign } from './cosign';

export type ProgressFn = (message: string) => void;

/** Minimal vault basket shape — avoids importing cvault (circular). */
export type TwapVaultAsset = {
  assetId: number;
  assetInfoPda: PublicKey;
  mint: PublicKey;
  priceSourceTag: number;
  priceDexKind: number;
  pricePoolAddress: PublicKey;
  route: string;
  decimals: number;
};

export type TwapVaultCtx = {
  numAssets: number;
  assets: TwapVaultAsset[];
};

export type TwapRefreshResult = {
  refreshed: number;
  signature: string | null;
  skipped: number;
};

type AssetInfoTwap = {
  active: boolean;
  twap: {
    lastUpdateTs: BN | number | { toString(): string };
    lastUpdateTwapKeeperTs?: BN | number | { toString(): string };
  };
};

/** Throw shape that {@link parseTxError} maps to a known Anchor code. */
function throwAnchorProgramError(code: number, name: string, message: string): never {
  throw new Error(
    `AnchorError occurred. Error Code: ${name}. Error Number: ${code}. Error Message: ${message}`,
  );
}

function isKeeperStampStale(
  lastUpdateTwapKeeperTs: number,
  now: number,
  maxAgeSecs: number = TWAP_KEEPER_MAX_STALE_SECS,
): boolean {
  if (!Number.isFinite(lastUpdateTwapKeeperTs) || lastUpdateTwapKeeperTs <= 0) return true;
  return now - lastUpdateTwapKeeperTs > maxAgeSecs;
}

/**
 * Read-only preflight for deposit / redeem / genesis — never sends a transaction.
 * Fails before any wallet signature when the on-chain dual-stale guard (6052)
 * or unset keeper (6050) would reject the swap path.
 */
export async function assertVaultDexTwapReadyForSwap(
  program: Program,
  ctx: TwapVaultCtx,
  onProgress?: ProgressFn,
): Promise<void> {
  const dexAssets = ctx.assets.filter((a) => a.priceSourceTag === PRICE_SOURCE_DEX);
  if (dexAssets.length === 0) return;

  onProgress?.(`Checking DEX TWAP freshness for ${dexAssets.length} vault asset(s)…`);

  const gs = await (program.account as any).globalState.fetch(deriveGlobalStatePda());
  const keeper = gs.twapKeeper as PublicKey;
  if (keeper.equals(PublicKey.default)) {
    throwAnchorProgramError(6050, 'TwapKeeperNotSet', 'No TWAP keeper has been assigned yet');
  }

  const now = Math.floor(Date.now() / 1000);
  const dualStaleIds: number[] = [];

  for (const asset of dexAssets) {
    let info: AssetInfoTwap;
    try {
      info = (await (program.account as any).assetInfo.fetch(
        asset.assetInfoPda,
      )) as AssetInfoTwap;
    } catch {
      dualStaleIds.push(asset.assetId);
      continue;
    }
    if (info.active === false) continue;

    const lastUpdateTs = Number(info.twap.lastUpdateTs.toString());
    const keeperTs = Number(info.twap.lastUpdateTwapKeeperTs?.toString?.() ?? 0);
    const observationStale = isObservationStale(lastUpdateTs, now);
    const keeperStale = isKeeperStampStale(keeperTs, now);

    if (observationStale && keeperStale) {
      dualStaleIds.push(asset.assetId);
    }
  }

  if (dualStaleIds.length > 0) {
    throwAnchorProgramError(
      6052,
      'LivePriceDiscrepancy',
      'Live price discrepancy — source not reliable (TWAP observation and keeper stamp both stale). ' +
        `Asset id(s): ${dualStaleIds.join(', ')}.`,
    );
  }

  onProgress?.('DEX TWAP observations fresh.');
}

/**
 * Refresh stale DEX TWAP observations for assets in this vault basket only.
 * Non-DEX (Pyth) assets are ignored. Spot comes from Whirlpool/DAMM pool only.
 */
export async function ensureVaultDexTwapFresh(
  connection: Connection,
  wallet: AnchorWallet,
  program: Program,
  ctx: TwapVaultCtx,
  onProgress?: ProgressFn,
  maxAgeSecs: number = TWAP_OBSERVATION_MAX_STALE_SECS,
): Promise<TwapRefreshResult> {
  const dexAssets = ctx.assets.filter((a) => a.priceSourceTag === PRICE_SOURCE_DEX);
  if (dexAssets.length === 0) {
    return { refreshed: 0, signature: null, skipped: 0 };
  }

  onProgress?.(
    `Checking DEX TWAP for ${dexAssets.length}/${ctx.numAssets} vault asset(s)…`,
  );

  const now = Math.floor(Date.now() / 1000);
  const targets: TwapVaultAsset[] = [];

  for (const asset of dexAssets) {
    let info: AssetInfoTwap;
    try {
      info = (await (program.account as any).assetInfo.fetch(
        asset.assetInfoPda,
      )) as AssetInfoTwap;
    } catch {
      continue;
    }
    if (info.active === false) continue;
    const lastUpdateTs = Number(info.twap.lastUpdateTs.toString());
    if (isObservationStale(lastUpdateTs, now, maxAgeSecs)) {
      targets.push(asset);
    }
  }

  if (targets.length === 0) {
    onProgress?.('DEX TWAP observations fresh.');
    return { refreshed: 0, signature: null, skipped: dexAssets.length };
  }

  // Packet-safe batch: at most 9 update_dex_twap ixs per tx (vault max / CU comfort).
  // Extra stale assets need another click of Refresh Asset.
  const batch = targets.slice(0, 9);
  if (targets.length > 9) {
    onProgress?.(
      `${targets.length} stale — refreshing first 9 in this transaction; run again for the rest.`,
    );
  }

  onProgress?.(
    `Refreshing ${batch.length} stale DEX TWAP(s) in one transaction ` +
      `(${batch.length} instruction(s); pool spot; you pay, keeper cosigns)…`,
  );

  // Build N small ixs, then send as ONE multi-ix transaction (not N txs).
  const ixs = [];
  for (const asset of batch) {
    const spot = await computeSpotPriceX64(connection, {
      mint: asset.mint,
      priceDexKind: asset.priceDexKind,
      pricePoolAddress: asset.pricePoolAddress,
      route: asset.route,
      decimals: asset.decimals,
    });
    const q32_32 = toQ32_32(spot.priceX64);
    onProgress?.(
      `  ix[${ixs.length}] asset ${asset.assetId} ${spot.dexLabel} ~$${spot.uiUsdEstimate.toFixed(4)}`,
    );

    const ix = await (program.methods as any)
      .updateDexTwap(new BN(asset.assetId), q32_32)
      .accounts({
        globalState: deriveGlobalStatePda(),
        assetInfo: deriveAssetInfoPda(asset.assetId),
        payer: wallet.publicKey,
        keeper: TWAP_KEEPER_PUBKEY,
      })
      .instruction();
    ixs.push(ix);
  }

  // Single VersionedTransaction: compute budget + all update_dex_twap ixs.
  const signature = await sendV0WithTwapKeeperCosign(connection, wallet, ixs);
  onProgress?.(
    `Refreshed ${batch.length} DEX TWAP observation(s) in 1 tx / ${ixs.length} ix(s) ` +
      `(sig ${signature.slice(0, 8)}…).`,
  );
  return { refreshed: batch.length, signature, skipped: 0 };
}

/**
 * Global scan: every listed DEX-priced AssetInfo (not vault-scoped).
 * Used by the error-modal "Refresh Asset" button when no vault id is known.
 * Still batches into one multi-ix tx (capped at 9 for packet safety).
 */
export async function refreshAllStaleDexTwaps(
  connection: Connection,
  wallet: AnchorWallet,
  program: Program,
  onProgress?: ProgressFn,
  maxAgeSecs: number = TWAP_OBSERVATION_MAX_STALE_SECS,
): Promise<TwapRefreshResult> {
  const gs = await (program.account as any).globalState.fetch(deriveGlobalStatePda());
  const totalAssets = Number(gs.totalAssets?.toString?.() ?? gs.totalAssets ?? 0);
  const assets: TwapVaultAsset[] = [];

  for (let id = 0; id < totalAssets; id++) {
    const pda = deriveAssetInfoPda(id);
    let account: any;
    try {
      account = await (program.account as any).assetInfo.fetch(pda);
    } catch {
      continue;
    }
    if (account.priceSourceTag !== PRICE_SOURCE_DEX) continue;
    if (account.active === false) continue;
    assets.push({
      assetId: id,
      assetInfoPda: pda,
      mint: account.mint,
      priceSourceTag: account.priceSourceTag,
      priceDexKind: Number(account.priceDexKind ?? 0),
      pricePoolAddress: account.pricePoolAddress,
      route: account.route?.viaSol ? 'ViaSol' : 'DirectUsdc',
      decimals: Number(account.decimals ?? 0),
    });
  }

  onProgress?.(`Scanning ${assets.length} global DEX-priced asset(s)…`);
  return ensureVaultDexTwapFresh(
    connection,
    wallet,
    program,
    { numAssets: assets.length, assets },
    onProgress,
    maxAgeSecs,
  );
}
