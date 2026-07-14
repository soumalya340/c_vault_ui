'use client';

/**
 * Build + create Address Lookup Tables for a vault (deposit/redeem packing).
 * Port of c_vault_script `lib/sdk/vaultAlt.js` — UI wallet signing.
 *
 * ALT is required for multi-asset deposit/genesis/redeem tx size. Callers must
 * not silently fall back to static keys when ensureVaultAlt fails.
 */

import { Buffer as NodeBuffer } from 'buffer';
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
} from '@solana/web3.js';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

import {
  buildVaultAltAddresses,
  createVaultAlt,
  fetchAlt,
} from './alt';
import { fetchPoolCtx } from './whirlpool';
import { fetchDammPoolCtx } from './damm';
import { deriveGlobalStatePda } from './pda';
import {
  WSOL_MINT,
  PRICE_SOURCE_PYTH,
  PRICE_SOURCE_DEX,
  SOL_USD_PYTH_FEED_ID,
  PYTH_PUSH_ORACLE_PROGRAM_ID,
  TOKEN_PROGRAM_TAG_SPL,
  TOKEN_PROGRAM_TAG_TOKEN_2022,
} from './constants';
import type { VaultChainCtx } from './cvault';

export type ProgressFn = (message: string) => void;

function pythFeedAccount(pythFeedId: number[] | Uint8Array): PublicKey {
  const shard = NodeBuffer.alloc(2);
  const [pda] = PublicKey.findProgramAddressSync(
    [shard, NodeBuffer.from(pythFeedId)],
    PYTH_PUSH_ORACLE_PROGRAM_ID,
  );
  return pda;
}

function tokenProgramForTag(tag: number): PublicKey {
  return tag === TOKEN_PROGRAM_TAG_TOKEN_2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

function vaultAssetAta(
  vaultAuthority: PublicKey,
  assetMint: PublicKey,
  tokenProgramTag: number = TOKEN_PROGRAM_TAG_SPL,
): PublicKey {
  return getAssociatedTokenAddressSync(
    assetMint,
    vaultAuthority,
    true,
    tokenProgramForTag(tokenProgramTag),
  );
}

/**
 * Poll until the ALT is readable with at least `minAddresses` entries.
 * Create+extend can confirm before the table is usable in a v0 message.
 */
export async function waitForAltActive(
  connection: Connection,
  altAddress: PublicKey,
  minAddresses = 1,
  onProgress?: ProgressFn,
): Promise<AddressLookupTableAccount> {
  onProgress?.('Waiting for ALT activation…');
  for (let i = 0; i < 40; i++) {
    const lut = await fetchAlt(connection, altAddress);
    if (lut && lut.state.addresses.length >= minAddresses) {
      onProgress?.(
        `ALT active (${lut.state.addresses.length} addresses): ${altAddress.toBase58()}`,
      );
      return lut;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(
    `ALT ${altAddress.toBase58()} did not activate in time — retry genesis / deposit to rebuild.`,
  );
}

/**
 * Collect whirlpool / DAMM pools + price feeds for a vault ctx and create an ALT.
 */
export async function createAltForVault(
  connection: Connection,
  wallet: AnchorWallet,
  ctx: VaultChainCtx,
  onProgress?: ProgressFn,
): Promise<{ altAddress: string; lut: AddressLookupTableAccount }> {
  const whirlpoolAddrs: PublicKey[] = [];
  const dammAddrs: PublicKey[] = [];

  if (ctx.usdcSolPool) whirlpoolAddrs.push(ctx.usdcSolPool);

  for (const a of ctx.assets) {
    if (a.swapKind === 'DammV2') dammAddrs.push(a.poolAddress);
    else whirlpoolAddrs.push(a.poolAddress);

    if (
      a.priceSourceTag === PRICE_SOURCE_DEX &&
      a.pricePoolAddress &&
      !a.pricePoolAddress.equals(PublicKey.default)
    ) {
      if (a.priceDexKind === 1) dammAddrs.push(a.pricePoolAddress);
      else whirlpoolAddrs.push(a.pricePoolAddress);
    }
  }

  const uniqueWp = [...new Map(whirlpoolAddrs.map((p) => [p.toBase58(), p])).values()];
  const uniqueDamm = [...new Map(dammAddrs.map((p) => [p.toBase58(), p])).values()];

  onProgress?.(
    `Fetching ${uniqueWp.length} Whirlpool + ${uniqueDamm.length} DAMM pool(s) for ALT…`,
  );
  const poolCtxs = (
    await Promise.all(uniqueWp.map((p) => fetchPoolCtx(connection, p).catch(() => null)))
  ).filter((p): p is NonNullable<typeof p> => p != null);
  const dammCtxs = (
    await Promise.all(uniqueDamm.map((p) => fetchDammPoolCtx(connection, p).catch(() => null)))
  ).filter((p): p is NonNullable<typeof p> => p != null);

  const assetMints = ctx.assets.map((a) => a.mint);
  const hasViaSol = ctx.assets.some((a) => a.route === 'ViaSol');
  const ataMints =
    hasViaSol && !assetMints.some((m) => m.equals(WSOL_MINT))
      ? [...assetMints, WSOL_MINT]
      : assetMints;

  const priceFeeds: PublicKey[] = [];
  for (const a of ctx.assets) {
    if (a.priceSourceTag === PRICE_SOURCE_PYTH) {
      const bytes = a.pythFeedId;
      if (bytes.some((b) => b !== 0)) priceFeeds.push(pythFeedAccount(bytes));
    }
  }
  if (
    ctx.assets.some(
      (a) => a.priceSourceTag === PRICE_SOURCE_DEX && a.route === 'ViaSol',
    )
  ) {
    priceFeeds.push(pythFeedAccount(SOL_USD_PYTH_FEED_ID));
  }

  const vaultAssetAtas = ataMints.map((m) => {
    const asset = ctx.assets.find((a) => a.mint.equals(m));
    if (asset) return asset.vaultAssetAtaKey;
    return vaultAssetAta(ctx.vaultAuthority, m, TOKEN_PROGRAM_TAG_SPL);
  });

  const addresses = buildVaultAltAddresses({
    globalState: deriveGlobalStatePda(),
    vaultPda: ctx.vaultPda,
    vaultAuthority: ctx.vaultAuthority,
    sharesMint: ctx.sharesMint,
    usdcVault: ctx.usdcVault,
    baseMint: ctx.baseMint,
    assetMints: ataMints,
    vaultAssetAtas,
    priceFeeds,
    pools: poolCtxs,
    dammPools: dammCtxs,
    extraKeys: ctx.assets.map((a) => a.assetInfoPda),
  });

  onProgress?.(`Creating ALT with ${addresses.length} addresses…`);
  const altPk = await createVaultAlt(connection, wallet, addresses);
  const lut = await waitForAltActive(connection, altPk, addresses.length, onProgress);
  return { altAddress: altPk.toBase58(), lut };
}

export type EnsuredVaultAlt = {
  lut: AddressLookupTableAccount;
  altAddress: string;
  /** True when we just created a new on-chain ALT (must be written to DB). */
  altCreated: boolean;
};

/**
 * Resolve a saved ALT if it is live on-chain; otherwise create a new one.
 * Never returns null — throws if creation fails. Multi-asset flows require this.
 */
export async function ensureVaultAlt(
  connection: Connection,
  wallet: AnchorWallet,
  ctx: VaultChainCtx,
  altAddress: string | null | undefined,
  onProgress?: ProgressFn,
): Promise<EnsuredVaultAlt> {
  let resolved = altAddress ? String(altAddress).trim() : '';
  if (resolved) {
    try {
      const lut = await fetchAlt(connection, new PublicKey(resolved));
      if (lut && lut.state.addresses.length > 0) {
        onProgress?.(`Reusing vault ALT: ${resolved}`);
        return { lut, altAddress: resolved, altCreated: false };
      }
      onProgress?.(
        `ALT ${resolved} not found / empty on-chain — creating a new one for this vault.`,
      );
    } catch {
      onProgress?.(
        `ALT ${resolved} unreadable — creating a new one for this vault.`,
      );
    }
  } else {
    onProgress?.(
      `No ALT saved for vault — creating one (${ctx.numAssets} asset(s); required for tx size)…`,
    );
  }

  try {
    const created = await createAltForVault(connection, wallet, ctx, onProgress);
    return {
      lut: created.lut,
      altAddress: created.altAddress,
      altCreated: true,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to create Address Lookup Table for vault (required for genesis/deposit/redeem): ${detail}`,
    );
  }
}
