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
import type { Connection, PublicKey } from '@solana/web3.js';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import type { Program } from '@coral-xyz/anchor';
import {
  PRICE_SOURCE_DEX,
  TWAP_KEEPER_PUBKEY,
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
  };
};

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

  // Hard cap: vault basket is at most 9 assets → at most 9 update_dex_twap ixs.
  if (targets.length > 9) {
    throw new Error(
      `Internal: ${targets.length} stale DEX TWAPs exceeds vault max of 9 assets`,
    );
  }

  onProgress?.(
    `Refreshing ${targets.length} stale DEX TWAP(s) in one transaction ` +
      `(${targets.length} instruction(s); pool spot; you pay, keeper cosigns)…`,
  );

  // Build N small ixs, then send as ONE multi-ix transaction (not N txs).
  const ixs = [];
  for (const asset of targets) {
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
    `Refreshed ${targets.length} DEX TWAP observation(s) in 1 tx / ${ixs.length} ix(s) ` +
      `(sig ${signature.slice(0, 8)}…).`,
  );
  return { refreshed: targets.length, signature, skipped: 0 };
}
