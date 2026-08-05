'use client';

import { Buffer as NodeBuffer } from 'buffer';
if (typeof globalThis !== 'undefined' && !('Buffer' in globalThis)) {
  (globalThis as { Buffer?: typeof NodeBuffer }).Buffer = NodeBuffer;
}

import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  getMint,
  unpackAccount,
} from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import type { AnchorWallet } from '@solana/wallet-adapter-react';

import { solscanLink, type Network } from './solscanLink';
import { createProgram, createDummyWallet } from './program';
import {
  buildV0,
  packIxsForAlt,
  sendV0,
  sendV0Packed,
  signAndSendV0Batches,
} from './alt';
import { ensureVaultAlt } from './vaultAlt';
import {
  deriveGlobalStatePda,
  deriveAssetInfoPda,
  deriveVaultPdas,
  deriveRedeemStatePda,
  deriveRedeemUsdcPda,
} from './pda';
import { fetchDecodedVault, type DecodedVault } from './vaultAccount';
import { fetchPoolCtx, ownerAccountsFor, type PoolCtx } from './whirlpool';
import { fetchDammPoolCtx, type DammPoolCtx } from './damm';
import { ensureLocalhostSwapPreflight } from './localhost';
import {
  C_VAULT_PROGRAM_ID,
  ADMIN_PUBKEY,
  DEFAULT_VAULT_ID,
  WSOL_MINT,
  WSOL_ASSET_ID,
  SOL_USD_PYTH_FEED_ID,
  SOL_USD_PYTH_FEED_ID_HEX,
  WHIRLPOOL_PROGRAM_ID,
  PYTH_PUSH_ORACLE_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  DAMM_V2_POOL_AUTHORITY,
  DAMM_V2_EVENT_AUTHORITY,
  PRICE_SOURCE_PYTH,
  PRICE_SOURCE_DEX,
  TOKEN_PROGRAM_TAG_SPL,
  TOKEN_PROGRAM_TAG_TOKEN_2022,
  NETWORK_CONSTANTS,
  PRICE_SCALE,
  PRICE_SCALE_DECIMALS,
  MULTI_TX_ASSET_THRESHOLD,
  SWAP_LEGS_PER_TX,
  VAULT_ATA_IXS_PER_TX,
  USDC_DECIMALS,
  MAX_ASSETS,
  MAX_DEPOSIT_FEE_BPS,
  MIN_REDEEM_FEE_BPS,
  MAX_REDEEM_FEE_BPS,
  CREATE_ETF_MAX_METADATA_BYTES,
} from './constants';
import { formatUserFacingError, parseTxError } from './txError';
import {
  type AssetHolding,
  type PricedAsset,
  priceToFixedPoint,
  totalUsdcValue,
  sharePriceRaw,
  previewSharesToMint,
  previewUsdcOut,
} from './navCalc';
import { fetchUsdPrices } from './jupiterPrice';
export { parseTxError, formatUserFacingError, type UserFacingError } from './txError';

export {
  C_VAULT_PROGRAM_ID,
  ADMIN_PUBKEY,
  DEFAULT_VAULT_ID,
  WSOL_MINT,
  WSOL_ASSET_ID,
  SOL_USD_PYTH_FEED_ID,
  SOL_USD_PYTH_FEED_ID_HEX,
  PRICE_SOURCE_PYTH,
  PRICE_SOURCE_DEX,
  TOKEN_PROGRAM_TAG_SPL,
  TOKEN_PROGRAM_TAG_TOKEN_2022,
  DAMM_V2_PROGRAM_ID,
  WHIRLPOOL_PROGRAM_ID,
  NETWORK_CONSTANTS,
  PRICE_SCALE,
  PRICE_SCALE_DECIMALS,
  MULTI_TX_ASSET_THRESHOLD,
  SWAP_LEGS_PER_TX,
  VAULT_ATA_IXS_PER_TX,
};
export {
  deriveGlobalStatePda,
  deriveAssetInfoPda,
  deriveVaultPdas,
  deriveRedeemStatePda,
  deriveRedeemUsdcPda,
};
export type { Network };

// ─── On-chain vault context ───────────────────────────────────────────────────
// Everything a vault instruction needs is read from the vault account itself
// (asset basket, pools, price sources, swap venues). Quote mint is always USDC.

export type AssetRoute = 'ViaSol' | 'DirectUsdc';
export type DexKindLabel = 'Whirlpool' | 'DammV2';

export interface VaultChainAsset {
  /** Global asset id — the admin-listed AssetInfo this slot references. */
  assetId: number;
  /** AssetInfo PDA `["asset", asset_id]` — leading remaining-account block. */
  assetInfoPda: PublicKey;
  mint: PublicKey;
  poolAddress: PublicKey;
  pythFeedId: number[];
  allocationBps: number;
  decimals: number;
  route: AssetRoute;
  priceSourceTag: number;
  priceDexKind: number;
  pricePoolAddress: PublicKey;
  swapKind: DexKindLabel;
  tokenProgramTag: number;
  vaultAssetAtaKey: PublicKey;
}

export interface VaultChainCtx {
  vaultId: number;
  vaultPda: PublicKey;
  vaultAuthority: PublicKey;
  sharesMint: PublicKey;
  usdcVault: PublicKey;
  /** Always mainnet USDC — sole eligible quote mint. */
  baseMint: PublicKey;
  usdcSolPool: PublicKey | null;
  feeRecipient: PublicKey;
  numAssets: number;
  assets: VaultChainAsset[];
}

/**
 * Canonical Pyth push-oracle PriceUpdateV2 account for a feed id
 * (PDA [shard 0 (u16 LE), feed_id]). The program validates feed data, not the
 * address, so the sponsored push feed is the right account on devnet.
 */
export function pythFeedAccount(pythFeedId: number[] | Uint8Array): PublicKey {
  const shard = NodeBuffer.alloc(2); // shard 0
  const [pda] = PublicKey.findProgramAddressSync(
    [shard, NodeBuffer.from(pythFeedId)],
    PYTH_PUSH_ORACLE_PROGRAM_ID,
  );
  return pda;
}

export function tokenProgramForTag(tag: number): PublicKey {
  return tag === TOKEN_PROGRAM_TAG_TOKEN_2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

export function vaultAssetAta(
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

function parseSwapKind(raw: unknown): DexKindLabel {
  if (raw && typeof raw === 'object' && 'dammV2' in (raw as object)) return 'DammV2';
  if (typeof raw === 'number' && raw === 1) return 'DammV2';
  return 'Whirlpool';
}

/** Raw AssetInfo account as Anchor deserializes it. */
interface RawAssetInfo {
  assetId: BN;
  mint: PublicKey;
  poolAddress: PublicKey;
  pythFeedId: number[] | Uint8Array;
  decimals: number;
  route: { viaSol?: Record<string, never>; directUsdc?: Record<string, never> };
  priceSourceTag: number;
  priceDexKind: number;
  pricePoolAddress: PublicKey;
  swapKind: unknown;
  tokenProgramTag: number;
  active: boolean;
}

function parseRoute(raw: RawAssetInfo['route']): AssetRoute {
  return raw.viaSol ? 'ViaSol' : 'DirectUsdc';
}

/** Anchor/RPC "account missing" — wording varies by path and Anchor version. */
function isAccountMissingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    /Account does not exist/i.test(msg) ||
    /has no data/i.test(msg) ||
    /AccountNotFound/i.test(msg) ||
    /could not find account/i.test(msg) ||
    /AccountNotInitialized/i.test(msg)
  );
}

/** Valid vault ids are `0 .. totalVaults-1` (0-based, sequential). */
async function formatVaultMissingError(
  connection: Connection,
  vaultId: number,
  vaultPda: PublicKey,
): Promise<Error> {
  let rangeHint = 'Vault ids are 0-based (first vault is 0). Check Global state → totalVaults.';
  try {
    const gs = await getGlobalState(connection);
    const total = Number(gs.totalVaults);
    if (!Number.isFinite(total) || total <= 0) {
      rangeHint = 'No vaults exist yet (totalVaults = 0). Open Create to mint one.';
    } else if (vaultId >= total) {
      rangeHint = `Only vault ids 0–${total - 1} exist (totalVaults = ${total}). You entered ${vaultId}.`;
    } else {
      rangeHint = `totalVaults = ${total}, so valid ids are 0–${total - 1}. PDA ${vaultPda.toBase58()} is empty.`;
    }
  } catch {
    // Global state unread — keep generic hint.
  }
  return new Error(`Vault ${vaultId} does not exist on-chain. ${rangeHint}`);
}

/** Valid asset ids are `0 .. totalAssets-1` (0-based; id 0 is genesis wSOL). */
async function formatAssetMissingError(connection: Connection, assetId: number): Promise<Error> {
  let rangeHint = 'Asset ids are 0-based (genesis wSOL is 0). Check Global state → totalAssets.';
  try {
    const gs = await getGlobalState(connection);
    const total = Number(gs.totalAssets);
    if (!Number.isFinite(total) || total <= 0) {
      rangeHint = 'No assets listed yet (totalAssets = 0). Run Initialize global state / Create asset.';
    } else if (assetId >= total) {
      rangeHint = `Only asset ids 0–${total - 1} are listed (totalAssets = ${total}). You entered ${assetId}.`;
    } else {
      rangeHint = `totalAssets = ${total}, so valid ids are 0–${total - 1}, but AssetInfo ${assetId} has no data.`;
    }
  } catch {
    // Global state unread — keep generic hint.
  }
  return new Error(`AssetInfo ${assetId} does not exist on-chain. ${rangeHint}`);
}

/**
 * Load vault PDAs + asset basket.
 *
 * Vault account bytes are decoded with a hand-rolled `repr(C)` reader
 * (`lib/vaultAccount.ts`) — Anchor's zero-copy coder mis-aligns this layout
 * and invents wrong `asset_ids` (e.g. id 1 when only id 0 is stored).
 */
export async function fetchVaultCtx(
  connection: Connection,
  vaultId: number,
  network: Network = 'mainnet',
): Promise<VaultChainCtx> {
  const program = createProgram(createDummyWallet(), connection);
  const { vaultPda, vaultAuthority, sharesMint, usdcVault } = deriveVaultPdas(vaultId, network);

  let vault: DecodedVault;
  try {
    const decoded = await fetchDecodedVault(connection, vaultPda);
    if (!decoded) {
      throw await formatVaultMissingError(connection, vaultId, vaultPda);
    }
    vault = decoded;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Vault ')) throw err;
    if (isAccountMissingError(err)) {
      throw await formatVaultMissingError(connection, vaultId, vaultPda);
    }
    throw err;
  }

  // v2: the vault stores only asset ids + allocations; every other asset
  // attribute lives on the global admin-listed AssetInfo PDAs.
  const numAssets = vault.numAssets;
  const assetIds = vault.assetIds.slice(0, numAssets).map((id) => id.toNumber());
  const allocationBps = vault.assetAllocationBps.slice(0, numAssets);
  const ataAddresses = vault.assetAtaAddress.slice(0, numAssets);

  const assetInfoPdas = assetIds.map((id) => deriveAssetInfoPda(id));
  const infos: (RawAssetInfo | null)[] = await (program.account as any).assetInfo.fetchMultiple(
    assetInfoPdas,
  );

  const assets: VaultChainAsset[] = [];
  for (let i = 0; i < infos.length; i++) {
    const info = infos[i];
    if (!info) {
      let totalHint = '';
      try {
        const gs = await getGlobalState(connection);
        totalHint = ` Global totalAssets = ${gs.totalAssets} (valid ids 0–${Math.max(0, Number(gs.totalAssets) - 1)}).`;
      } catch {
        // ignore
      }
      throw new Error(
        `Vault ${vaultId} references asset id ${assetIds[i]}, but that AssetInfo PDA is missing on-chain.${totalHint} ` +
          `List the asset (Admin → Create asset) or create a vault that only uses listed asset ids.`,
      );
    }
    assets.push({
      assetId: assetIds[i],
      assetInfoPda: assetInfoPdas[i],
      mint: info.mint,
      poolAddress: info.poolAddress,
      pythFeedId: Array.from(info.pythFeedId),
      allocationBps: allocationBps[i],
      decimals: info.decimals,
      route: parseRoute(info.route),
      priceSourceTag: info.priceSourceTag,
      priceDexKind: info.priceDexKind,
      pricePoolAddress: info.pricePoolAddress,
      swapKind: parseSwapKind(info.swapKind),
      tokenProgramTag: info.tokenProgramTag,
      vaultAssetAtaKey:
        ataAddresses[i] && !ataAddresses[i].equals(PublicKey.default)
          ? ataAddresses[i]
          : vaultAssetAta(vaultAuthority, info.mint, info.tokenProgramTag),
    });
  }

  // USDC↔wSOL pool is no longer stored on the Vault account — use the
  // canonical Orca pool for this cluster when any basket asset routes ViaSol.
  const needsUsdcSol = assets.some((a) => a.route === 'ViaSol');
  const usdcSolPool = needsUsdcSol ? NETWORK_CONSTANTS[network].wsolUsdcPool : null;

  return {
    vaultId,
    vaultPda,
    vaultAuthority,
    sharesMint,
    usdcVault,
    baseMint: NETWORK_CONSTANTS[network].usdcMint,
    usdcSolPool,
    feeRecipient: vault.feeRecipient,
    numAssets,
    assets,
  };
}

export interface AssetInfoView {
  assetId: number;
  mint: string;
  poolAddress: string;
  decimals: number;
  route: AssetRoute;
  priceSourceTag: number;
  priceDexKind: number;
  pricePoolAddress: string;
  swapKind: DexKindLabel;
  tokenProgramTag: number;
  pythFeedId: number[];
  active: boolean;
}

/** Every admin-listed AssetInfo PDA — for the create_etf asset picker and ALT building. */
export async function listAssets(connection: Connection): Promise<AssetInfoView[]> {
  const program = createProgram(createDummyWallet(), connection);
  const rows: { account: RawAssetInfo }[] = await (program.account as any).assetInfo.all();
  return rows
    .map(({ account }) => ({
      assetId: account.assetId.toNumber(),
      mint: account.mint.toBase58(),
      poolAddress: account.poolAddress.toBase58(),
      decimals: account.decimals,
      route: parseRoute(account.route),
      priceSourceTag: account.priceSourceTag,
      priceDexKind: account.priceDexKind,
      pricePoolAddress: account.pricePoolAddress.toBase58(),
      swapKind: parseSwapKind(account.swapKind),
      tokenProgramTag: account.tokenProgramTag,
      pythFeedId: Array.from(account.pythFeedId),
      active: account.active,
    }))
    .sort((a, b) => a.assetId - b.assetId);
}

/** Single admin-listed AssetInfo by id — `["asset", asset_id]` PDA lookup. */
export async function getAssetState(
  connection: Connection,
  assetId: number,
): Promise<AssetInfoView> {
  const program = createProgram(createDummyWallet(), connection);
  const assetInfoPda = deriveAssetInfoPda(assetId);
  let account: RawAssetInfo;
  try {
    account = await (program.account as any).assetInfo.fetch(assetInfoPda);
  } catch (err) {
    if (isAccountMissingError(err)) {
      throw await formatAssetMissingError(connection, assetId);
    }
    throw err;
  }
  return {
    assetId: account.assetId.toNumber(),
    mint: account.mint.toBase58(),
    poolAddress: account.poolAddress.toBase58(),
    decimals: account.decimals,
    route: parseRoute(account.route),
    priceSourceTag: account.priceSourceTag,
    priceDexKind: account.priceDexKind,
    pricePoolAddress: account.pricePoolAddress.toBase58(),
    swapKind: parseSwapKind(account.swapKind),
    tokenProgramTag: account.tokenProgramTag,
    pythFeedId: Array.from(account.pythFeedId),
    active: account.active,
  };
}

type AccountMeta = { pubkey: PublicKey; isSigner: boolean; isWritable: boolean };

function readonlyMetas(keys: PublicKey[]): AccountMeta[] {
  return keys.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }));
}

/** Leading AssetInfo PDA block every v2 vault instruction expects, ordered
 *  to match `Vault.asset_ids[0..num_assets]`. Deposit needs it writable —
 *  AssetInfo accounts are read-only during deposit (live spot pricing). */
function assetInfoMetas(ctx: VaultChainCtx, writable = false): AccountMeta[] {
  return ctx.assets.map((a) => ({
    pubkey: a.assetInfoPda,
    isSigner: false,
    isWritable: writable,
  }));
}

/**
 * Variable-stride remaining_accounts for deposit / NAV / preview (matches
 * `sum_nav` / `dex_price_account_stride` on-chain):
 * `[asset_info_0..N, asset_ata_0..N, then per asset:
 *   Pyth: feed |
 *   DEX DirectUsdc: pool [+ whirlpool vault_a, vault_b] |
 *   DEX ViaSol:     pool [+ whirlpool vaults] + SOL/USD Pyth feed]`.
 */
async function navRemainingAccounts(
  connection: Connection,
  ctx: VaultChainCtx,
  opts: { assetInfoWritable?: boolean } = {},
): Promise<AccountMeta[]> {
  const atas = ctx.assets.map((a) => a.vaultAssetAtaKey);
  const priceKeys: PublicKey[] = [];

  for (const asset of ctx.assets) {
    if (asset.priceSourceTag === PRICE_SOURCE_DEX) {
      priceKeys.push(asset.pricePoolAddress);
      if (asset.priceDexKind === 0) {
        // Whirlpool pricing needs the two token vaults after the pool.
        const pool = await fetchPoolCtx(connection, asset.pricePoolAddress);
        priceKeys.push(pool.info.tokenVaultA, pool.info.tokenVaultB);
      }
      // DammV2: pool only — then ViaSol still needs SOL/USD for token×SOL→USD.
      // Program: `token_usd = dex(token/SOL) × pyth(SOL/USD)` (calculate_nav.rs).
      if (asset.route === 'ViaSol') {
        priceKeys.push(pythFeedAccount(SOL_USD_PYTH_FEED_ID));
      }
    } else {
      priceKeys.push(pythFeedAccount(asset.pythFeedId));
    }
  }

  return [
    ...assetInfoMetas(ctx, opts.assetInfoWritable ?? false),
    ...readonlyMetas(atas),
    ...readonlyMetas(priceKeys),
  ];
}

/** `[asset_info_0..N, asset_ata_0..N]` — request_redeem reads asset config
 *  from the AssetInfo block and balances from the ATA block. */
function assetAtaRemainingAccounts(ctx: VaultChainCtx): AccountMeta[] {
  return [
    ...assetInfoMetas(ctx),
    ...readonlyMetas(ctx.assets.map((a) => a.vaultAssetAtaKey)),
  ];
}

function baseAta(owner: PublicKey, baseMint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(baseMint, owner, false, TOKEN_PROGRAM_ID);
}

async function fetchTreasury(connection: Connection): Promise<PublicKey> {
  const program = createProgram(createDummyWallet(), connection);
  const gs = await (program.account as any).globalState.fetch(deriveGlobalStatePda());
  return gs.treasuryAddr as PublicKey;
}

// ─── Admin instructions (GlobalState-scoped, devnet) ─────────────────────────

/**
 * Send a single-instruction Anchor method through sendV0 (build instruction →
 * v0 tx → poll-confirm) instead of Anchor's `.rpc()`. `.rpc()` confirms via the
 * websocket subscription with a hard 30s cap, which the public devnet RPC trips
 * even when the tx lands ("not confirmed / unknown if it succeeded"). Every
 * admin / vault-ops call routes through here so they all get robust confirmation.
 */
async function sendMethod(
  connection: Connection,
  wallet: AnchorWallet,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  methodBuilder: any,
  network: Network,
) {
  const ix = await methodBuilder.instruction();
  const sig = await sendV0(connection, wallet, [ix]);
  return { tx: sig, link: solscanLink(sig, network) };
}

function globalAdminAccounts(admin: PublicKey) {
  return { globalState: deriveGlobalStatePda(), admin } as Record<string, PublicKey>;
}

/**
 * One-time bootstrap: creates `GlobalState` *and* the genesis wSOL AssetInfo
 * (id `WSOL_ASSET_ID` == 0, permanently reserved) in a single instruction.
 * Treasury defaults to the admin signer. Takes the same `CreateAssetParams`
 * shape as `createAsset` — the program runs the identical listing validation
 * on the genesis asset (see admin/init_global_state.rs).
 */
export async function initGlobalState(
  connection: Connection,
  wallet: AnchorWallet,
  solAssetParams: CreateAssetParams,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const remaining = await assetListingRemainingAccounts(connection, solAssetParams);
  return sendMethod(
    connection,
    wallet,
    (program.methods as any)
      .initGlobalState({
        mint: solAssetParams.mint,
        poolAddress: solAssetParams.poolAddress,
        pythFeedId: solAssetParams.pythFeedId,
        route: solAssetParams.route,
        priceSourceTag: solAssetParams.priceSourceTag,
        priceDexKind: solAssetParams.priceDexKind,
        pricePoolAddress: solAssetParams.pricePoolAddress,
        swapKind: solAssetParams.swapKind,
        tokenProgramTag: solAssetParams.tokenProgramTag,
      })
      .accounts({
        globalState: deriveGlobalStatePda(),
        assetInfo: deriveAssetInfoPda(WSOL_ASSET_ID),
        mint: solAssetParams.mint,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      } as never)
      .remainingAccounts(remaining),
    network,
  );
}

export async function updateTreasuryAddr(
  connection: Connection,
  wallet: AnchorWallet,
  treasury: PublicKey,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  return sendMethod(
    connection,
    wallet,
    (program.methods as any)
      .updateTreasuryAddr(treasury)
      .accounts(globalAdminAccounts(wallet.publicKey) as never),
    network,
  );
}

export async function setEmergency(
  connection: Connection,
  wallet: AnchorWallet,
  isEmergency: boolean,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  return sendMethod(
    connection,
    wallet,
    (program.methods as any)
      .setEmergency(isEmergency)
      .accounts(globalAdminAccounts(wallet.publicKey) as never),
    network,
  );
}

export interface CreateAssetParams {
  mint: PublicKey;
  poolAddress: PublicKey;
  pythFeedId: number[];
  route: { directUsdc: Record<string, never> } | { viaSol: Record<string, never> };
  /** 0 = Pyth, 1 = Dex */
  priceSourceTag: number;
  /** DexKind as u8 when priceSourceTag is Dex; ignored for Pyth. */
  priceDexKind: number;
  pricePoolAddress: PublicKey;
  swapKind: { whirlpool: Record<string, never> } | { dammV2: Record<string, never> };
  /** 0 = SPL Token, 1 = Token-2022 */
  tokenProgramTag: number;
}

/**
 * remaining_accounts for the shared asset-listing validation the program runs
 * in `init_asset_info_fields` (asset_ops.rs) — used by both `create_asset`
 * and `init_global_state`. DEX-priced assets pass the price pool, plus the
 * Whirlpool token vaults A/B when the price venue is a Whirlpool, plus the
 * SOL/USD Pyth feed when the route is ViaSol (the token/SOL DEX price is
 * converted to USD via Pyth). Pyth-priced assets pass nothing.
 */
async function assetListingRemainingAccounts(
  connection: Connection,
  params: CreateAssetParams,
): Promise<AccountMeta[]> {
  if (params.priceSourceTag !== PRICE_SOURCE_DEX) return [];
  const remaining: AccountMeta[] = [
    { pubkey: params.pricePoolAddress, isSigner: false, isWritable: false },
  ];
  if (params.priceDexKind !== 1) {
    // DexKind::Whirlpool — vaults A/B follow the pool.
    const pool = await fetchPoolCtx(connection, params.pricePoolAddress);
    remaining.push(
      { pubkey: pool.info.tokenVaultA, isSigner: false, isWritable: false },
      { pubkey: pool.info.tokenVaultB, isSigner: false, isWritable: false },
    );
  }
  if ('viaSol' in params.route) {
    remaining.push({
      pubkey: pythFeedAccount(SOL_USD_PYTH_FEED_ID),
      isSigner: false,
      isWritable: false,
    });
  }
  return remaining;
}

/**
 * Admin-only: list a new global asset. `asset_id` is assigned from
 * `global_state.total_assets`, fetched here so the caller doesn't have to.
 * DEX-priced assets need the price pool (+ Whirlpool token vaults A/B, + the
 * SOL/USD Pyth feed on ViaSol routes) as remaining_accounts.
 */
export async function createAsset(
  connection: Connection,
  wallet: AnchorWallet,
  params: CreateAssetParams,
  network: Network,
): Promise<{ tx: string; link: string; assetId: number; decimals: number }> {
  const program = createProgram(wallet, connection);
  const gs = await (program.account as any).globalState.fetch(deriveGlobalStatePda());
  const assetId = (gs.totalAssets as BN).toNumber();
  const assetInfo = deriveAssetInfoPda(assetId);
  const mintInfo = await getMint(
    connection,
    params.mint,
    undefined,
    tokenProgramForTag(params.tokenProgramTag),
  );

  const remaining = await assetListingRemainingAccounts(connection, params);

  const r = await sendMethod(
    connection,
    wallet,
    (program.methods as any)
      .createAsset({
        mint: params.mint,
        poolAddress: params.poolAddress,
        pythFeedId: params.pythFeedId,
        route: params.route,
        priceSourceTag: params.priceSourceTag,
        priceDexKind: params.priceDexKind,
        pricePoolAddress: params.pricePoolAddress,
        swapKind: params.swapKind,
        tokenProgramTag: params.tokenProgramTag,
      })
      .accounts({
        globalState: deriveGlobalStatePda(),
        assetInfo,
        mint: params.mint,
        admin: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      } as never)
      .remainingAccounts(remaining),
    network,
  );
  return { ...r, assetId, decimals: mintInfo.decimals };
}

/** Admin-only: flip an asset's `active` flag (blocks new create_etf inclusion only). */
export async function setAssetActive(
  connection: Connection,
  wallet: AnchorWallet,
  assetId: number,
  active: boolean,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  return sendMethod(
    connection,
    wallet,
    (program.methods as any)
      .setAssetActive(new BN(assetId), active)
      .accounts({
        assetInfo: deriveAssetInfoPda(assetId),
        admin: wallet.publicKey,
      } as never),
    network,
  );
}

/** Admin-only: lock/unlock deposits for one vault, independent of the vault manager's own pause. */
export async function setVaultEmergencyLock(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  locked: boolean,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const { vaultPda } = deriveVaultPdas(vaultId, network);
  return sendMethod(
    connection,
    wallet,
    (program.methods as any)
      .setVaultEmergencyLock(new BN(vaultId), locked)
      .accounts({
        vault: vaultPda,
        admin: wallet.publicKey,
      } as never),
    network,
  );
}

// ─── Vault Ops — vault_ops.rs (vault-manager-scoped) ─────────────────────────

function vaultManagerAccounts(vaultId: number, vaultManager: PublicKey, network: Network) {
  const { vaultPda } = deriveVaultPdas(vaultId, network);
  return { vault: vaultPda, vaultManager } as Record<string, PublicKey>;
}

export async function setPaused(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  paused: boolean,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  return sendMethod(
    connection,
    wallet,
    (program.methods as any)
      .setPaused(new BN(vaultId), paused)
      .accounts(vaultManagerAccounts(vaultId, wallet.publicKey, network) as never),
    network,
  );
}

export async function setFeeRecipient(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  feeRecipient: PublicKey,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  return sendMethod(
    connection,
    wallet,
    (program.methods as any)
      .setFeeRecipient(new BN(vaultId), feeRecipient)
      .accounts(vaultManagerAccounts(vaultId, wallet.publicKey, network) as never),
    network,
  );
}

// ─── Create ETF (create_etf.rs — vault + Token-2022 metadata in one tx) ──────

export interface AssetAllocation {
  /** References an existing, active AssetInfo PDA listed via create_asset. */
  assetId: number;
  allocationBps: number;
}

export interface CreateEtfParams {
  feeRecipient: PublicKey | null;
  depositFeeBps: number;
  redeemFeeBps: number;
  assets: AssetAllocation[];
  fundType: { fixed: Record<string, never> } | { dynamic: Record<string, never> };
  maxShares: BN | null;
}

export interface CreatedVaultInfo {
  tx: string;
  link: string;
  vaultId: number;
  vaultPda: PublicKey;
  vaultAuthority: PublicKey;
  sharesMint: PublicKey;
  usdcVault: PublicKey;
}

/**
 * Encode instruction args with a buffer large enough for long Token-2022
 * metadata. Anchor's stock coder uses `Buffer.alloc(1000)` and throws
 * "encoding overruns Buffer" once name+symbol+uri (+ params) exceed that.
 * Mirrors `BorshInstructionCoder.encode` but with a 16 KiB scratch buffer.
 */
function encodeInstructionData(
  program: ReturnType<typeof createProgram>,
  ixName: string,
  args: Record<string, unknown>,
): Buffer {
  const coder = program.coder.instruction as {
    encode: (name: string, args: unknown) => Buffer;
    ixLayouts: Map<
      string,
      {
        discriminator: number[] | Buffer;
        layout: { encode: (data: unknown, buffer: Buffer) => number };
      }
    >;
  };

  try {
    return coder.encode(ixName, args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Anchor uses Buffer; some layout paths surface Uint8Array.
    if (!/encoding overruns (Buffer|Uint8Array)/i.test(msg)) throw err;
  }

  const encoder = coder.ixLayouts.get(ixName);
  if (!encoder) throw new Error(`Unknown instruction: ${ixName}`);
  const buffer = Buffer.alloc(16_384);
  const len = encoder.layout.encode(args, buffer);
  const disc = Buffer.from(encoder.discriminator);
  return Buffer.concat([disc, buffer.subarray(0, len)]);
}

/**
 * Validate share-token metadata for `create_etf` before building the tx.
 * Rejects embedded `data:` URIs and combined name+symbol+uri over the
 * static-packet budget (see CREATE_ETF_MAX_METADATA_BYTES).
 */
export function assertCreateEtfMetadata(name: string, symbol: string, uri: string): void {
  const n = name.trim();
  const s = symbol.trim();
  const u = uri.trim();
  if (!n) throw new Error('Vault name is required.');
  if (!s) throw new Error('Vault symbol is required.');
  if (!u) throw new Error('Metadata URI is required.');

  if (/^data:/i.test(u)) {
    throw new Error(
      'Metadata URI cannot be a data: URL (base64 image/JSON). ' +
        'Host the image or metadata JSON off-chain and paste a short https:// link. ' +
        'Embedded data blows past Solana’s 1232-byte transaction limit ' +
        '(“encoding overruns Uint8Array”).',
    );
  }

  const metaBytes =
    Buffer.byteLength(n, 'utf8') +
    Buffer.byteLength(s, 'utf8') +
    Buffer.byteLength(u, 'utf8');
  if (metaBytes > CREATE_ETF_MAX_METADATA_BYTES) {
    throw new Error(
      `Name + symbol + URI is too long (${metaBytes} bytes; max ${CREATE_ETF_MAX_METADATA_BYTES}). ` +
        `Use a short https metadata URL — do not paste base64 or long data URIs.`,
    );
  }
}

/**
 * Runs create_etf, which also initializes the share mint's Token-2022
 * metadata (name/symbol/uri) inside the same instruction — one signature,
 * one transaction. Returns the assigned vault id and PDAs so the caller can
 * record the vault off-chain.
 *
 * Account list matches `CreateEtf` in `create_etf.rs` and the LiteSVM helper
 * `build_create_etf_ix` in `deps/c_vault/programs/vault/tests/common/mod.rs`:
 * remaining_accounts is one AssetInfo PDA per `params.assets` entry, in order.
 * `etf_creation_authority` is a required signer; while the gate is
 * `Pubkey::default()` any signer (including the vault manager) is accepted.
 */
export async function createEtf(
  connection: Connection,
  wallet: AnchorWallet,
  params: CreateEtfParams,
  name: string,
  symbol: string,
  uri: string,
  network: Network,
): Promise<CreatedVaultInfo> {
  // ── Client-side mirrors of create_etf_handler validation ─────────────────
  if (!name.trim()) throw new Error('Vault name is required.');
  if (!symbol.trim()) throw new Error('Vault symbol is required.');
  if (params.assets.length === 0) throw new Error('Add at least one asset.');
  if (params.assets.length > MAX_ASSETS) {
    throw new Error(`Too many assets (max ${MAX_ASSETS}).`);
  }
  if (params.depositFeeBps < 0 || params.depositFeeBps > MAX_DEPOSIT_FEE_BPS) {
    throw new Error(`Deposit fee must be 0–${MAX_DEPOSIT_FEE_BPS} bps.`);
  }
  if (
    params.redeemFeeBps < MIN_REDEEM_FEE_BPS ||
    params.redeemFeeBps > MAX_REDEEM_FEE_BPS
  ) {
    throw new Error(
      `Redeem fee must be ${MIN_REDEEM_FEE_BPS}–${MAX_REDEEM_FEE_BPS} bps (on-chain minimum ${MIN_REDEEM_FEE_BPS}).`,
    );
  }
  const totalBps = params.assets.reduce((s, a) => s + a.allocationBps, 0);
  if (totalBps !== 10_000) {
    throw new Error(`Allocations must sum to 10_000 bps (got ${totalBps}).`);
  }
  const isFixed = 'fixed' in params.fundType;
  if (isFixed && (!params.maxShares || params.maxShares.isZero())) {
    throw new Error('Fixed vaults require a positive max shares cap.');
  }

  // Metadata lives in the instruction data of a single static-key transaction
  // (no ALT yet). Base64 data:image URIs blow past Solana's 1232-byte packet.
  assertCreateEtfMetadata(name, symbol, uri);

  const program = createProgram(wallet, connection);

  // The program assigns vault_id = global_state.total_vaults at execution.
  const gs = await (program.account as any).globalState.fetch(deriveGlobalStatePda());
  const vaultId = (gs.totalVaults as BN).toNumber();
  const pdas = deriveVaultPdas(vaultId, network);
  const globalState = deriveGlobalStatePda();
  const usdcMint = NETWORK_CONSTANTS[network].usdcMint;

  // Matches on-chain InitializeParams / tests::make_etf_params.
  // Program.methods camelCases field names; FundType unit variants use
  // lowercase keys (`{ dynamic: {} }`) which Anchor maps to the rust-repr enum.
  const ixParams = {
    feeRecipient: params.feeRecipient,
    depositFeeBps: params.depositFeeBps,
    redeemFeeBps: params.redeemFeeBps,
    assets: params.assets.map((a) => ({
      assetId: new BN(a.assetId),
      allocationBps: a.allocationBps,
    })),
    fundType: params.fundType,
    maxShares: isFixed ? params.maxShares : null,
  };

  // Explicit account list — same order as CreateEtf in create_etf.rs /
  // tests::build_create_etf_ix (avoid auto-resolve depth issues).
  const keys: AccountMeta[] = [
    { pubkey: globalState, isSigner: false, isWritable: true },
    { pubkey: pdas.vaultPda, isSigner: false, isWritable: true },
    { pubkey: pdas.vaultAuthority, isSigner: false, isWritable: false },
    { pubkey: pdas.sharesMint, isSigner: false, isWritable: true },
    { pubkey: pdas.usdcVault, isSigner: false, isWritable: true },
    { pubkey: usdcMint, isSigner: false, isWritable: false },
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
    // Gate disabled while etf_creation_authority == Pubkey::default();
    // any signer is accepted — use the connected wallet (same as tests).
    { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    // remaining_accounts: AssetInfo PDAs in params.assets order (readonly).
    ...params.assets.map((a) => ({
      pubkey: deriveAssetInfoPda(a.assetId),
      isSigner: false,
      isWritable: false,
    })),
  ];

  let data: Buffer;
  try {
    data = encodeInstructionData(program, 'createEtf', {
      params: ixParams,
      name,
      symbol,
      uri,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/encoding overruns (Buffer|Uint8Array)/i.test(msg)) {
      const metaBytes =
        Buffer.byteLength(name, 'utf8') +
        Buffer.byteLength(symbol, 'utf8') +
        Buffer.byteLength(uri, 'utf8');
      throw new Error(
        `create_etf instruction data too large (${msg}). ` +
          `Shorten name/symbol/uri (combined UTF-8 length is ${metaBytes} bytes; ` +
          `max ${CREATE_ETF_MAX_METADATA_BYTES}). Use a short https metadata URL.`,
      );
    }
    if (/unable to infer src variant/i.test(msg)) {
      throw new Error(
        `create_etf FundType encode failed (${msg}). Expected fundType ` +
          `{ fixed: {} } or { dynamic: {} }.`,
      );
    }
    throw err;
  }

  const createIx = new TransactionInstruction({
    programId: C_VAULT_PROGRAM_ID,
    keys,
    data,
  });

  // sendV0 (not Anchor `.rpc()`): polls signature status instead of the flaky
  // public-RPC websocket 30s confirm path.
  const sig = await sendV0(connection, wallet, [createIx]);
  return {
    tx: sig,
    link: solscanLink(sig, network),
    vaultId,
    vaultPda: pdas.vaultPda,
    vaultAuthority: pdas.vaultAuthority,
    sharesMint: pdas.sharesMint,
    usdcVault: pdas.usdcVault,
  };
}

// ─── Core: deposit / request_redeem / claim ───────────────────────────────────

/**
 * `[ensure user ATAs ×2, deposit]` — user ATAs (base + Token-2022 share) are
 * created idempotently in the same transaction, so no separate "create token
 * accounts" step exists.
 */
async function buildDepositIxs(
  connection: Connection,
  program: ReturnType<typeof createProgram>,
  ctx: VaultChainCtx,
  user: PublicKey,
  usdcAmount: BN,
  minSharesOut: BN,
): Promise<TransactionInstruction[]> {
  const userBase = baseAta(user, ctx.baseMint);
  const userShares = getAssociatedTokenAddressSync(
    ctx.sharesMint, user, false, TOKEN_2022_PROGRAM_ID,
  );
  const treasury = await fetchTreasury(connection);

  const ensureAtaIxs: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(
      user, userBase, user, ctx.baseMint, TOKEN_PROGRAM_ID,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      user, userShares, user, ctx.sharesMint, TOKEN_2022_PROGRAM_ID,
    ),
  ];

  const depositIx = await (program.methods as any)
    .deposit(new BN(ctx.vaultId), usdcAmount, minSharesOut)
    .accounts({
      globalState: deriveGlobalStatePda(),
      vault: ctx.vaultPda,
      usdcMint: ctx.baseMint,
      vaultAuthority: ctx.vaultAuthority,
      usdcVault: ctx.usdcVault,
      shareMint: ctx.sharesMint,
      userUsdcAccount: userBase,
      userShareAccount: userShares,
      user,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      baseTokenProgram: TOKEN_PROGRAM_ID,
      treasury,
      feeRecipient: ctx.feeRecipient,
      treasuryUsdcAccount: baseAta(treasury, ctx.baseMint),
      feeRecipientUsdcAccount: baseAta(ctx.feeRecipient, ctx.baseMint),
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    } as never)
    // AssetInfo is read-only now (no TWAP writeback) — enables parallel deposits.
    .remainingAccounts(await navRemainingAccounts(connection, ctx, { assetInfoWritable: false }))
    .instruction();

  return [...ensureAtaIxs, depositIx];
}

/** Instruction A of the deposit flow, without the inflow swap legs. */
export async function deposit(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  usdcAmount: BN,
  minSharesOut: BN,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const ixs = await buildDepositIxs(
    connection, program, ctx, wallet.publicKey, usdcAmount, minSharesOut,
  );
  const sig = await sendV0(connection, wallet, ixs);
  return { tx: sig, link: solscanLink(sig, network) };
}

/** `[request_redeem]` — the program burns the user's shares directly
 * (user-signed CPI), no delegated approve needed. */
async function buildRequestRedeemIxs(
  program: ReturnType<typeof createProgram>,
  ctx: VaultChainCtx,
  user: PublicKey,
  shares: BN,
): Promise<TransactionInstruction[]> {
  const userShares = getAssociatedTokenAddressSync(
    ctx.sharesMint, user, false, TOKEN_2022_PROGRAM_ID,
  );
  const redeemIx = await (program.methods as any)
    .requestRedeem(new BN(ctx.vaultId), shares)
    .accounts({
      globalState: deriveGlobalStatePda(),
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
      sharesMint: ctx.sharesMint,
      userShareAccount: userShares,
      redeemState: deriveRedeemStatePda(user, ctx.vaultId),
      usdcMint: ctx.baseMint,
      usdcVault: ctx.usdcVault,
      redeemUsdc: deriveRedeemUsdcPda(user, ctx.vaultId),
      user,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      baseTokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as never)
    .remainingAccounts(assetAtaRemainingAccounts(ctx))
    .instruction();
  return [redeemIx];
}

export async function requestRedeem(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  shares: BN,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const ixs = await buildRequestRedeemIxs(program, ctx, wallet.publicKey, shares);
  const sig = await sendV0(connection, wallet, ixs);
  return { tx: sig, link: solscanLink(sig, network) };
}

async function buildClaimIxs(
  connection: Connection,
  program: ReturnType<typeof createProgram>,
  ctx: VaultChainCtx,
  user: PublicKey,
): Promise<TransactionInstruction[]> {
  const userBase = baseAta(user, ctx.baseMint);
  const treasury = await fetchTreasury(connection);

  const ensureUserBaseIx = createAssociatedTokenAccountIdempotentInstruction(
    user, userBase, user, ctx.baseMint, TOKEN_PROGRAM_ID,
  );
  const claimIx = await (program.methods as any)
    .claim(new BN(ctx.vaultId))
    .accounts({
      globalState: deriveGlobalStatePda(),
      vault: ctx.vaultPda,
      usdcMint: ctx.baseMint,
      vaultAuthority: ctx.vaultAuthority,
      redeemState: deriveRedeemStatePda(user, ctx.vaultId),
      redeemUsdc: deriveRedeemUsdcPda(user, ctx.vaultId),
      userUsdcAccount: userBase,
      user,
      treasury,
      treasuryUsdcAccount: baseAta(treasury, ctx.baseMint),
      feeRecipient: ctx.feeRecipient,
      feeRecipientUsdcAccount: baseAta(ctx.feeRecipient, ctx.baseMint),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    } as never)
    .instruction();
  return [ensureUserBaseIx, claimIx];
}

export async function claim(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const ixs = await buildClaimIxs(connection, program, ctx, wallet.publicKey);
  const sig = await sendV0(connection, wallet, ixs);
  return { tx: sig, link: solscanLink(sig, network) };
}

// ─── Swap legs (accounts derived from the vault's asset basket) ──────────────

function requireUsdcSolPool(ctx: VaultChainCtx): PublicKey {
  if (!ctx.usdcSolPool) {
    throw new Error('This vault has no USDC/wSOL pool configured (all assets are DirectUsdc).');
  }
  return ctx.usdcSolPool;
}

function assetAt(ctx: VaultChainCtx, assetIndex: number): VaultChainAsset {
  const asset = ctx.assets[assetIndex];
  if (!asset) throw new Error(`Vault ${ctx.vaultId} has no asset at index ${assetIndex}`);
  return asset;
}

/** Named accounts for USDC↔wSOL Whirlpool swap_v2 legs (swap_usdc_to_sol / swap_sol_to_usdc). */
function whirlpoolUsdcSolAccounts(
  pool: PoolCtx,
  owners: { ownerA: PublicKey; ownerB: PublicKey },
) {
  return {
    tokenProgramA: TOKEN_PROGRAM_ID,
    tokenProgramB: TOKEN_PROGRAM_ID,
    memoProgram: MEMO_PROGRAM_ID,
    whirlpoolProgram: WHIRLPOOL_PROGRAM_ID,
    whirlpool: pool.address,
    tokenMintA: pool.info.tokenMintA,
    tokenMintB: pool.info.tokenMintB,
    tokenOwnerAccountA: owners.ownerA,
    tokenVaultA: pool.info.tokenVaultA,
    tokenOwnerAccountB: owners.ownerB,
    tokenVaultB: pool.info.tokenVaultB,
    tickArray0: pool.tickArrays[0],
    tickArray1: pool.tickArrays[1],
    tickArray2: pool.tickArrays[2],
    oracle: pool.oracle,
  };
}

/**
 * Whirlpool asset-swap remaining_accounts (length 15) — see
 * `dispatch_orca_asset_swap` in the program.
 */
function whirlpoolAssetRemaining(
  pool: PoolCtx,
  owners: { ownerA: PublicKey; ownerB: PublicKey },
  tokenProgramA: PublicKey = TOKEN_PROGRAM_ID,
  tokenProgramB: PublicKey = TOKEN_PROGRAM_ID,
): AccountMeta[] {
  const keys: PublicKey[] = [
    WHIRLPOOL_PROGRAM_ID,
    tokenProgramA,
    tokenProgramB,
    MEMO_PROGRAM_ID,
    pool.address,
    pool.info.tokenMintA,
    pool.info.tokenMintB,
    owners.ownerA,
    pool.info.tokenVaultA,
    owners.ownerB,
    pool.info.tokenVaultB,
    pool.tickArrays[0],
    pool.tickArrays[1],
    pool.tickArrays[2],
    pool.oracle,
  ];
  // Mix of readonly / writable — mark vaults, owner ATAs, and oracle writable
  // (matches `anchor_orca_swap_v2`'s CPI AccountMetas in whirlpool_cpi.rs).
  const writable = new Set([
    owners.ownerA.toBase58(),
    owners.ownerB.toBase58(),
    pool.info.tokenVaultA.toBase58(),
    pool.info.tokenVaultB.toBase58(),
    pool.address.toBase58(),
    pool.tickArrays[0].toBase58(),
    pool.tickArrays[1].toBase58(),
    pool.tickArrays[2].toBase58(),
    pool.oracle.toBase58(),
  ]);
  return keys.map((pubkey) => ({
    pubkey,
    isSigner: false,
    isWritable: writable.has(pubkey.toBase58()),
  }));
}

/**
 * DAMM v2 remaining_accounts (length 15):
 * [program, pool_authority, pool, input, output, vault_a, vault_b, mint_a, mint_b,
 *  payer, token_a_program, token_b_program, referral, event_authority, program]
 */
function dammAssetRemaining(
  pool: DammPoolCtx,
  inputAccount: PublicKey,
  outputAccount: PublicKey,
  vaultAuthority: PublicKey,
  tokenProgramA: PublicKey = TOKEN_PROGRAM_ID,
  tokenProgramB: PublicKey = TOKEN_PROGRAM_ID,
): AccountMeta[] {
  const keys: Array<{ pk: PublicKey; w: boolean }> = [
    { pk: DAMM_V2_PROGRAM_ID, w: false },
    { pk: DAMM_V2_POOL_AUTHORITY, w: false },
    { pk: pool.address, w: true },
    { pk: inputAccount, w: true },
    { pk: outputAccount, w: true },
    { pk: pool.info.tokenVaultA, w: true },
    { pk: pool.info.tokenVaultB, w: true },
    { pk: pool.info.tokenMintA, w: false },
    { pk: pool.info.tokenMintB, w: false },
    { pk: vaultAuthority, w: false }, // payer/signer via seeds
    { pk: tokenProgramA, w: false },
    { pk: tokenProgramB, w: false },
    { pk: DAMM_V2_PROGRAM_ID, w: true }, // no-referral placeholder (mut)
    { pk: DAMM_V2_EVENT_AUTHORITY, w: false },
    { pk: DAMM_V2_PROGRAM_ID, w: false },
  ];
  return keys.map(({ pk, w }) => ({ pubkey: pk, isSigner: false, isWritable: w }));
}

async function buildAssetSwapRemaining(
  connection: Connection,
  ctx: VaultChainCtx,
  asset: VaultChainAsset,
  inputMint: PublicKey,
  inputAccount: PublicKey,
  outputAccount: PublicKey,
): Promise<{ remaining: AccountMeta[]; aToB: boolean }> {
  if (asset.swapKind === 'DammV2') {
    const pool = await fetchDammPoolCtx(connection, asset.poolAddress);
    const aToB = pool.info.tokenMintA.equals(inputMint);
    const tokenProgramA = pool.info.tokenMintA.equals(asset.mint)
      ? tokenProgramForTag(asset.tokenProgramTag)
      : TOKEN_PROGRAM_ID;
    const tokenProgramB = pool.info.tokenMintB.equals(asset.mint)
      ? tokenProgramForTag(asset.tokenProgramTag)
      : TOKEN_PROGRAM_ID;
    return {
      remaining: dammAssetRemaining(
        pool,
        inputAccount,
        outputAccount,
        ctx.vaultAuthority,
        tokenProgramA,
        tokenProgramB,
      ),
      aToB,
    };
  }

  const pool = await fetchPoolCtx(connection, asset.poolAddress);
  const owners = pool.info.tokenMintA.equals(inputMint)
    ? { ownerA: inputAccount, ownerB: outputAccount }
    : { ownerA: outputAccount, ownerB: inputAccount };
  const aToB = pool.info.tokenMintA.equals(inputMint);
  const tokenProgramA = pool.info.tokenMintA.equals(asset.mint)
    ? tokenProgramForTag(asset.tokenProgramTag)
    : TOKEN_PROGRAM_ID;
  const tokenProgramB = pool.info.tokenMintB.equals(asset.mint)
    ? tokenProgramForTag(asset.tokenProgramTag)
    : TOKEN_PROGRAM_ID;
  return {
    remaining: whirlpoolAssetRemaining(pool, owners, tokenProgramA, tokenProgramB),
    aToB,
  };
}

/** Inflow leg builder: pending USDC (ViaSol slice) → wSOL. */
async function buildSwapUsdcToSolIx(
  connection: Connection,
  program: ReturnType<typeof createProgram>,
  ctx: VaultChainCtx,
  signer: PublicKey,
  minWsolOut: BN,
): Promise<TransactionInstruction> {
  const vaultWsolAta = vaultAssetAta(ctx.vaultAuthority, WSOL_MINT);
  const pool = await fetchPoolCtx(connection, requireUsdcSolPool(ctx));
  const owners = ownerAccountsFor(pool, vaultWsolAta, ctx.baseMint, ctx.usdcVault);
  const aToB = pool.info.tokenMintA.equals(ctx.baseMint);

  // Program requires remaining_accounts = [asset_info_0..N] ordered like
  // Vault.asset_ids (route / ViaSol-slice math). sol_asset_info is a separate
  // typed account (genesis wSOL) resolved by Anchor PDA seeds — not these.
  return (program.methods as any)
    .swapUsdcToSol(new BN(ctx.vaultId), minWsolOut, aToB)
    .accounts({
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
      solAssetInfo: deriveAssetInfoPda(WSOL_ASSET_ID),
      signer,
      ...whirlpoolUsdcSolAccounts(pool, owners),
      usdcVault: ctx.usdcVault,
      wsolOwnerAccount: vaultWsolAta,
    } as never)
    .remainingAccounts(assetInfoMetas(ctx))
    .instruction();
}

/** Inflow: pending USDC (ViaSol slice) → wSOL. */
export async function swapUsdcToSol(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  minWsolOut: BN,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const ix = await buildSwapUsdcToSolIx(connection, program, ctx, wallet.publicKey, minWsolOut);
  const sig = await sendV0(connection, wallet, [ix]);
  return { tx: sig, link: solscanLink(sig, network) };
}

/** Inflow leg builder: pending USDC → one DirectUsdc asset slot. */
async function buildSwapUsdcToAssetIx(
  connection: Connection,
  program: ReturnType<typeof createProgram>,
  ctx: VaultChainCtx,
  assetIndex: number,
  signer: PublicKey,
  minAssetOut: BN,
): Promise<TransactionInstruction> {
  const asset = assetAt(ctx, assetIndex);
  const assetAta = asset.vaultAssetAtaKey;
  const { remaining, aToB } = await buildAssetSwapRemaining(
    connection,
    ctx,
    asset,
    ctx.baseMint,
    ctx.usdcVault,
    assetAta,
  );

  return (program.methods as any)
    .swapUsdcToAsset(new BN(ctx.vaultId), assetIndex, minAssetOut, aToB)
    .accounts({
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
      assetInfo: asset.assetInfoPda,
      usdcVault: ctx.usdcVault,
      signer,
    } as never)
    .remainingAccounts(remaining)
    .instruction();
}

/** Inflow: pending USDC → one DirectUsdc asset slot. */
export async function swapUsdcToAsset(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  assetIndex: number,
  minAssetOut: BN,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const ix = await buildSwapUsdcToAssetIx(
    connection, program, ctx, assetIndex, wallet.publicKey, minAssetOut,
  );
  const sig = await sendV0(connection, wallet, [ix]);
  return { tx: sig, link: solscanLink(sig, network) };
}

/** Inflow leg builder: pending wSOL → one ViaSol asset slot. */
async function buildSwapSolToAssetIx(
  connection: Connection,
  program: ReturnType<typeof createProgram>,
  ctx: VaultChainCtx,
  assetIndex: number,
  signer: PublicKey,
  minAssetOut: BN,
): Promise<TransactionInstruction> {
  const asset = assetAt(ctx, assetIndex);
  const vaultWsolAta = vaultAssetAta(ctx.vaultAuthority, WSOL_MINT);
  const assetAta = asset.vaultAssetAtaKey;
  const { remaining, aToB } = await buildAssetSwapRemaining(
    connection,
    ctx,
    asset,
    WSOL_MINT,
    vaultWsolAta,
    assetAta,
  );

    return (program.methods as any)
    .swapSolToAsset(new BN(ctx.vaultId), assetIndex, minAssetOut, aToB)
    .accounts({
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
      assetInfo: asset.assetInfoPda,
      wsolVault: vaultWsolAta,
      signer,
    } as never)
    .remainingAccounts(remaining)
    .instruction();
}

/** Inflow: pending wSOL → one ViaSol asset slot. */
export async function swapSolToAsset(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  assetIndex: number,
  minAssetOut: BN,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const ix = await buildSwapSolToAssetIx(
    connection, program, ctx, assetIndex, wallet.publicKey, minAssetOut,
  );
  const sig = await sendV0(connection, wallet, [ix]);
  return { tx: sig, link: solscanLink(sig, network) };
}

/** Outflow leg-1 builder (ViaSol): one redeemed asset slot → wSOL. */
async function buildSwapAssetToSolIx(
  connection: Connection,
  program: ReturnType<typeof createProgram>,
  ctx: VaultChainCtx,
  assetIndex: number,
  user: PublicKey,
  minWsolOut: BN,
): Promise<TransactionInstruction> {
  const asset = assetAt(ctx, assetIndex);
  const vaultWsolAta = vaultAssetAta(ctx.vaultAuthority, WSOL_MINT);
  const assetAta = asset.vaultAssetAtaKey;
  const { remaining, aToB } = await buildAssetSwapRemaining(
    connection,
    ctx,
    asset,
    asset.mint,
    assetAta,
    vaultWsolAta,
  );

  return (program.methods as any)
    .swapAssetToSol(new BN(ctx.vaultId), assetIndex, minWsolOut, aToB)
    .accounts({
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
      assetInfo: asset.assetInfoPda,
      redeemState: deriveRedeemStatePda(user, ctx.vaultId),
      wsolVault: vaultWsolAta,
      user,
    } as never)
    .remainingAccounts(remaining)
    .instruction();
}

/** Outflow leg 1 (ViaSol): one redeemed asset slot → wSOL. */
export async function swapAssetToSol(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  assetIndex: number,
  minWsolOut: BN,
  user: PublicKey,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const ix = await buildSwapAssetToSolIx(connection, program, ctx, assetIndex, user, minWsolOut);
  const sig = await sendV0(connection, wallet, [ix]);
  return { tx: sig, link: solscanLink(sig, network) };
}

/** Outflow leg-2 builder (ViaSol): measured leg-1 wSOL → redeem_usdc escrow. */
async function buildSwapSolToUsdcIx(
  connection: Connection,
  program: ReturnType<typeof createProgram>,
  ctx: VaultChainCtx,
  assetIndex: number,
  minUsdcOut: BN,
  user: PublicKey,
): Promise<TransactionInstruction> {
  const vaultWsolAta = vaultAssetAta(ctx.vaultAuthority, WSOL_MINT);
  const pool = await fetchPoolCtx(connection, requireUsdcSolPool(ctx));
  // Destination is the per-redeem escrow (C-03), not the shared usdc_vault.
  const redeemUsdc = deriveRedeemUsdcPda(user, ctx.vaultId);
  const owners = ownerAccountsFor(pool, vaultWsolAta, ctx.baseMint, redeemUsdc);
  const aToB = pool.info.tokenMintA.equals(WSOL_MINT);

  return (program.methods as any)
    .swapSolToUsdc(new BN(ctx.vaultId), assetIndex, minUsdcOut, aToB)
    .accounts({
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
      solAssetInfo: deriveAssetInfoPda(WSOL_ASSET_ID),
      redeemState: deriveRedeemStatePda(user, ctx.vaultId),
      redeemUsdc,
      wsolVault: vaultWsolAta,
      user,
      ...whirlpoolUsdcSolAccounts(pool, owners),
    } as never)
    .instruction();
}

/** Outflow leg 2 (ViaSol): measured leg-1 wSOL → redeem_usdc escrow. */
export async function swapSolToUsdc(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  assetIndex: number,
  minUsdcOut: BN,
  user: PublicKey,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const ix = await buildSwapSolToUsdcIx(
    connection, program, ctx, assetIndex, minUsdcOut, user,
  );
  const sig = await sendV0(connection, wallet, [ix]);
  return { tx: sig, link: solscanLink(sig, network) };
}

/** Outflow builder (DirectUsdc): one redeemed asset slot → USDC, single hop. */
async function buildSwapAssetToUsdcIx(
  connection: Connection,
  program: ReturnType<typeof createProgram>,
  ctx: VaultChainCtx,
  assetIndex: number,
  user: PublicKey,
  minUsdcOut: BN,
): Promise<TransactionInstruction> {
  const asset = assetAt(ctx, assetIndex);
  const assetAta = asset.vaultAssetAtaKey;
  const redeemUsdc = deriveRedeemUsdcPda(user, ctx.vaultId);
  const { remaining, aToB } = await buildAssetSwapRemaining(
    connection,
    ctx,
    asset,
    asset.mint,
    assetAta,
    redeemUsdc,
  );

  return (program.methods as any)
    .swapAssetToUsdc(new BN(ctx.vaultId), assetIndex, minUsdcOut, aToB)
    .accounts({
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
      assetInfo: asset.assetInfoPda,
      redeemState: deriveRedeemStatePda(user, ctx.vaultId),
      redeemUsdc,
      user,
    } as never)
    .remainingAccounts(remaining)
    .instruction();
}

/** Outflow (DirectUsdc): one redeemed asset slot → USDC, single hop. */
export async function swapAssetToUsdc(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  assetIndex: number,
  minUsdcOut: BN,
  user: PublicKey,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const ix = await buildSwapAssetToUsdcIx(connection, program, ctx, assetIndex, user, minUsdcOut);
  const sig = await sendV0(connection, wallet, [ix]);
  return { tx: sig, link: solscanLink(sig, network) };
}

// ─── Bundled flows (ALT-compressed v0 transactions — Plan.md §6-9) ────────────
// ≤4 assets: one v0 tx with the vault ALT. >4 assets: split setup vs swap legs
// (see MULTI_TX_ASSET_THRESHOLD / c_vault_script/Rules.md). ALT is stored in
// `vaults.alt_address` and used for swap-heavy transactions only when split.

export type ProgressFn = (message: string) => void;

/**
 * Preflight before mutative deposit / redeem / genesis.
 * Localhost only — synthetic Pyth + Whirlpool clock (Surfpool).
 * Deposit prices DEX assets at live pool spot (no keeper TWAP).
 */
async function prepareSwapPreflight(
  connection: Connection,
  _wallet: AnchorWallet,
  _program: ReturnType<typeof createProgram>,
  network: Network,
  ctx: VaultChainCtx,
  onProgress?: ProgressFn,
): Promise<void> {
  await ensureLocalhostSwapPreflight(
    connection,
    network,
    {
      assets: ctx.assets.map((a) => ({
        priceSourceTag: a.priceSourceTag,
        pythFeedId: a.pythFeedId,
        mint: a.mint,
        poolAddress: a.poolAddress,
        decimals: a.decimals,
        swapKind: a.swapKind,
      })),
      usdcSolPool: ctx.usdcSolPool,
    },
    onProgress,
  );
}

/** Surfpool-only oracle prep for gasless views (no TWAP keeper tx). */
async function prepareLocalhostOracles(
  connection: Connection,
  network: Network,
  ctx: VaultChainCtx,
  onProgress?: ProgressFn,
): Promise<void> {
  await ensureLocalhostSwapPreflight(
    connection,
    network,
    {
      assets: ctx.assets.map((a) => ({
        priceSourceTag: a.priceSourceTag,
        pythFeedId: a.pythFeedId,
        mint: a.mint,
        poolAddress: a.poolAddress,
        decimals: a.decimals,
        swapKind: a.swapKind,
      })),
      usdcSolPool: ctx.usdcSolPool,
    },
    onProgress,
  );
}

export type VaultAltResult = {
  altAddress: string;
  altCreated: boolean;
};

/** True when the vault basket must be split across multiple v0 transactions. */
function needsMultiTxBundle(ctx: Pick<VaultChainCtx, 'numAssets'>): boolean {
  return ctx.numAssets > MULTI_TX_ASSET_THRESHOLD;
}

/**
 * Genesis for >4 assets: vault ATAs (setup, only if missing) → then pack
 * signer ATAs + genesis + all inflow swaps into as few ALT v0 txs as fit
 * under the 1232-byte / ~64-account envelope.
 *
 * All resulting transactions share **one** wallet approval (`signAllTransactions`),
 * then land sequentially over plain RPC (no Jito).
 */
async function sendGenesisBundle(
  connection: Connection,
  wallet: AnchorWallet,
  vaultAtaIxs: TransactionInstruction[],
  signerAtaIxs: TransactionInstruction[],
  genesisIx: TransactionInstruction,
  swapIxs: TransactionInstruction[],
  lut: AddressLookupTableAccount,
  _network: Network,
  onProgress?: ProgressFn,
): Promise<string[]> {
  // Pack seed + all swaps together — ALT compresses keys so 5-asset baskets
  // often land in 1 tx; overflow greedily splits into the fewest packets.
  const coreIxs = [...signerAtaIxs, genesisIx, ...swapIxs];
  const setupBatches = chunkIxs(vaultAtaIxs, VAULT_ATA_IXS_PER_TX);
  const coreBatches = packIxsForAlt(wallet.publicKey, coreIxs, lut);
  const allBatches = [...setupBatches, ...coreBatches];

  onProgress?.(
    `Genesis: ${vaultAtaIxs.length} vault ATA ix(s) + seed + ${swapIxs.length} swap(s) ` +
      `→ ${allBatches.length} ALT tx(s), one wallet approval…`,
  );

  return signAndSendV0Batches(connection, wallet, allBatches, lut, onProgress);
}

/** Split instructions into fixed-size batches (no packing / size checks). */
function chunkIxs(
  ixs: TransactionInstruction[],
  perTx: number,
): TransactionInstruction[][] {
  if (!ixs.length) return [];
  const batches: TransactionInstruction[][] = [];
  for (let i = 0; i < ixs.length; i += perTx) {
    batches.push(ixs.slice(i, i + perTx));
  }
  return batches;
}

/** Idempotent creates for the vault-authority ATAs the swap legs write to. */
function ensureVaultAssetAtaIxs(payer: PublicKey, ctx: VaultChainCtx): TransactionInstruction[] {
  const ixs = ctx.assets.map((a) =>
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      a.vaultAssetAtaKey,
      ctx.vaultAuthority,
      a.mint,
      tokenProgramForTag(a.tokenProgramTag),
    ),
  );
  if (
    ctx.assets.some((a) => a.route === 'ViaSol') &&
    !ctx.assets.some((a) => a.mint.equals(WSOL_MINT))
  ) {
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        vaultAssetAta(ctx.vaultAuthority, WSOL_MINT),
        ctx.vaultAuthority,
        WSOL_MINT,
        TOKEN_PROGRAM_ID,
      ),
    );
  }
  return ixs;
}

/** ATA creates for vault-authority token accounts that are not on-chain yet. */
async function buildMissingVaultAtaIxs(
  connection: Connection,
  payer: PublicKey,
  ctx: VaultChainCtx,
): Promise<TransactionInstruction[]> {
  const missing = await findMissingVaultAtas(connection, ctx);
  return missing.map((c) =>
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      c.key,
      ctx.vaultAuthority,
      c.mint,
      tokenProgramForTag(c.tokenProgramTag),
    ),
  );
}

/** Vault-authority ATA the views may need, plus the wSOL ViaSol hop ATA. */
type VaultAtaCandidate = {
  key: PublicKey;
  mint: PublicKey;
  tokenProgramTag: number;
};

function vaultAtaCandidates(ctx: VaultChainCtx): VaultAtaCandidate[] {
  const candidates: VaultAtaCandidate[] = ctx.assets.map((a) => ({
    key: a.vaultAssetAtaKey,
    mint: a.mint,
    tokenProgramTag: a.tokenProgramTag,
  }));
  if (
    ctx.assets.some((a) => a.route === 'ViaSol') &&
    !ctx.assets.some((a) => a.mint.equals(WSOL_MINT))
  ) {
    candidates.push({
      key: vaultAssetAta(ctx.vaultAuthority, WSOL_MINT),
      mint: WSOL_MINT,
      tokenProgramTag: TOKEN_PROGRAM_TAG_SPL,
    });
  }
  return candidates;
}

/** Subset of {@link vaultAtaCandidates} that does not exist on-chain yet. */
async function findMissingVaultAtas(
  connection: Connection,
  ctx: VaultChainCtx,
): Promise<VaultAtaCandidate[]> {
  const candidates = vaultAtaCandidates(ctx);
  const infos = await connection.getMultipleAccountsInfo(candidates.map((c) => c.key));
  return candidates.filter((_, i) => !infos[i]);
}

/** List missing accounts that cause NAV/preview AccountNotFound. */
async function diagnoseMissingNavAccounts(
  connection: Connection,
  ctx: VaultChainCtx,
  opts: { ignoreAtas?: boolean } = {},
): Promise<string[]> {
  const missing: string[] = [];
  if (!opts.ignoreAtas) {
    const ataInfos = await connection.getMultipleAccountsInfo(
      ctx.assets.map((a) => a.vaultAssetAtaKey),
    );
    for (let i = 0; i < ctx.assets.length; i++) {
      if (!ataInfos[i]) {
        missing.push(`vault ATA for asset ${ctx.assets[i].assetId} (${ctx.assets[i].mint.toBase58().slice(0, 8)}…)`);
      }
    }
  }

  const feedKeys: { key: PublicKey; label: string }[] = [];
  for (const asset of ctx.assets) {
    if (asset.priceSourceTag === PRICE_SOURCE_DEX) {
      if (asset.route === 'ViaSol') {
        feedKeys.push({
          key: pythFeedAccount(SOL_USD_PYTH_FEED_ID),
          label: 'SOL/USD Pyth feed',
        });
      }
    } else {
      feedKeys.push({
        key: pythFeedAccount(asset.pythFeedId),
        label: `Pyth feed for asset ${asset.assetId}`,
      });
    }
  }
  // Dedupe by base58
  const seen = new Set<string>();
  const unique = feedKeys.filter((f) => {
    const k = f.key.toBase58();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length > 0) {
    const feedInfos = await connection.getMultipleAccountsInfo(unique.map((f) => f.key));
    for (let i = 0; i < unique.length; i++) {
      if (!feedInfos[i]) missing.push(unique[i].label);
    }
  }
  return missing;
}

/**
 * Shared preflight for NAV / preview views.
 *
 * On-chain view paths (`get_total_nav_view`, `preview_deposit`,
 * `preview_redeem`) pass `use_spot = true` and price from live DEX spot —
 * they do **not** touch TwapState or the staleness/keeper guard. Do not
 * DEX assets price at live pool spot — no keeper freshness gate.
 *
 * 1. Localhost: synthetic Pyth + Whirlpool clock.
 * 2. Missing vault ATAs → idempotent create ixs as `preInstructions` only
 *    (simulated rent payer; not sent for the view itself).
 */
async function prepareViewAccounts(
  connection: Connection,
  network: Network,
  ctx: VaultChainCtx,
  wallet?: AnchorWallet | null,
  onProgress?: ProgressFn,
): Promise<TransactionInstruction[]> {
  await prepareLocalhostOracles(connection, network, ctx, onProgress);

  const missingAtas = await findMissingVaultAtas(connection, ctx);
  const payer = wallet?.publicKey;
  const preIxs =
    payer && missingAtas.length > 0
      ? missingAtas.map((c) =>
          createAssociatedTokenAccountIdempotentInstruction(
            payer,
            c.key,
            ctx.vaultAuthority,
            c.mint,
            tokenProgramForTag(c.tokenProgramTag),
          ),
        )
      : [];

  // Anything the simulation can't conjure — price feeds always, ATAs when
  // there is no wallet to act as the simulated rent payer — fails early with
  // a precise list instead of Anchor's opaque AccountNotFound.
  const missing = await diagnoseMissingNavAccounts(connection, ctx, {
    ignoreAtas: preIxs.length > 0,
  });
  if (missing.length > 0) {
    const hint = wallet
      ? 'These accounts must exist on-chain before the view can run.'
      : 'Connect a wallet and retry — the view simulates the ATA creation (gasless, nothing is sent on-chain).';
    throw new Error(
      `Missing on-chain accounts for NAV/preview: ${missing.join('; ')}. ${hint}`,
    );
  }
  return preIxs;
}

/**
 * Inflow swap legs for one vault (Plan.md §1-2): the vault is fetched by id,
 * then `assets[0..num_assets]` is walked slot by slot and a leg is queued per
 * route — one USDC→wSOL conversion when anything routes ViaSol, wSOL→asset
 * for each non-wSOL ViaSol slot, USDC→asset for each non-base DirectUsdc slot.
 */
async function buildInflowSwapIxs(
  connection: Connection,
  program: ReturnType<typeof createProgram>,
  ctx: VaultChainCtx,
  signer: PublicKey,
  opts: { includeUsdcToSol?: boolean } = {},
): Promise<TransactionInstruction[]> {
  const ixs: TransactionInstruction[] = [];
  const hasViaSol = ctx.assets.some((a) => a.route === 'ViaSol');
  if (hasViaSol && (opts.includeUsdcToSol ?? true)) {
    ixs.push(await buildSwapUsdcToSolIx(connection, program, ctx, signer, new BN(0)));
  }
  for (let i = 0; i < ctx.assets.length; i++) {
    const asset = ctx.assets[i];
    if (asset.route === 'ViaSol' && !asset.mint.equals(WSOL_MINT)) {
      ixs.push(await buildSwapSolToAssetIx(connection, program, ctx, i, signer, new BN(0)));
    } else if (asset.route === 'DirectUsdc' && !asset.mint.equals(ctx.baseMint)) {
      ixs.push(await buildSwapUsdcToAssetIx(connection, program, ctx, i, signer, new BN(0)));
    }
  }
  return ixs;
}

/**
 * Deposit + all inflow swap legs in ONE v0 transaction (Plan.md §7-9):
 * `[ensure ATAs, deposit, swap_usdc_to_sol, swap_sol_to_asset ×N, swap_usdc_to_asset ×N]`.
 * No user pre-checks — the program enforces everything (Plan.md §9).
 */
export async function depositAndDeploy(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  usdcAmount: BN,
  minSharesOut: BN,
  altAddress: string | null | undefined,
  network: Network,
  onProgress?: ProgressFn,
): Promise<{ tx: string; link: string; signatures: string[] } & VaultAltResult> {
  const program = createProgram(wallet, connection);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  await prepareSwapPreflight(connection, wallet, program, network, ctx, onProgress);
  // ALT is required for swap legs — create on the fly if create_etf never saved one.
  const ensured = await ensureVaultAlt(connection, wallet, ctx, altAddress, onProgress);

  const swapIxs = await buildInflowSwapIxs(connection, program, ctx, wallet.publicKey);

  let signatures: string[];
  try {
    if (needsMultiTxBundle(ctx)) {
      const vaultAtaIxs = await buildMissingVaultAtaIxs(connection, wallet.publicKey, ctx);
      const depositIxs = await buildDepositIxs(
        connection,
        program,
        ctx,
        wallet.publicKey,
        usdcAmount,
        minSharesOut,
      );
      // Pack user ATAs + deposit + all swaps with ALT. Greedy pack keeps
      // signatures minimal under the 1232-byte / ~64-account envelope.
      // Setup + core share one signAllTransactions popup (plain RPC, no Jito).
      const coreIxs = [...depositIxs, ...swapIxs];
      const setupBatches = chunkIxs(vaultAtaIxs, VAULT_ATA_IXS_PER_TX);
      const coreBatches = packIxsForAlt(wallet.publicKey, coreIxs, ensured.lut);
      const allBatches = [...setupBatches, ...coreBatches];
      onProgress?.(
        `${ctx.numAssets} assets (> ${MULTI_TX_ASSET_THRESHOLD}) — ` +
          `${vaultAtaIxs.length} ATA ix(s) + deposit + ${swapIxs.length} swap(s) → ` +
          `${allBatches.length} ALT tx(s), one wallet approval…`,
      );
      signatures = await signAndSendV0Batches(
        connection,
        wallet,
        allBatches,
        ensured.lut,
        onProgress,
      );
    } else {
      const vaultAtaIxs = ensureVaultAssetAtaIxs(wallet.publicKey, ctx);
      const depositIxs = await buildDepositIxs(
        connection,
        program,
        ctx,
        wallet.publicKey,
        usdcAmount,
        minSharesOut,
      );
      const sig = await sendV0(
        connection,
        wallet,
        [...vaultAtaIxs, ...depositIxs, ...swapIxs],
        ensured.lut,
      );
      signatures = [sig];
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/encoding overruns|Transaction too large|too large|Wallet could not sign/i.test(msg)) {
      throw new Error(
        `${msg}\n` +
          `Deposit+deploy packed too many accounts. Re-run with a vault ALT ` +
          `(or leave blank to auto-create). Current ALT: ${ensured.altAddress || '(none)'}`,
      );
    }
    throw err;
  }

  const tx = signatures[signatures.length - 1]!;
  return {
    tx,
    link: solscanLink(tx, network),
    signatures,
    altAddress: ensured.altAddress,
    altCreated: ensured.altCreated,
  };
}

// ─── Genesis deposit (one-time seed) ─────────────────────────────────────────

/** Idempotent USDC ATA for the genesis signer + vault-owned share ATA. */
function buildSignerAtaIxs(ctx: VaultChainCtx, authority: PublicKey): TransactionInstruction[] {
  const authorityUsdc = baseAta(authority, ctx.baseMint);
  // Genesis shares mint to the vault authority PDA (permanently locked).
  const vaultShareAccount = getAssociatedTokenAddressSync(
    ctx.sharesMint, ctx.vaultAuthority, true, TOKEN_2022_PROGRAM_ID,
  );
  return [
    createAssociatedTokenAccountIdempotentInstruction(
      authority, authorityUsdc, authority, ctx.baseMint, TOKEN_PROGRAM_ID,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      authority, vaultShareAccount, ctx.vaultAuthority, ctx.sharesMint, TOKEN_2022_PROGRAM_ID,
    ),
  ];
}

/**
 * `genesis_deposit` only — signer USDC + vault share ATAs must already exist
 * (built separately by `buildSignerAtaIxs`). remaining_accounts = AssetInfo
 * PDAs in slot order.
 */
async function buildGenesisDepositIx(
  program: ReturnType<typeof createProgram>,
  ctx: VaultChainCtx,
  authority: PublicKey,
  baselineSharePrice: BN,
): Promise<TransactionInstruction> {
  const authorityUsdc = baseAta(authority, ctx.baseMint);
  const vaultShareAccount = getAssociatedTokenAddressSync(
    ctx.sharesMint, ctx.vaultAuthority, true, TOKEN_2022_PROGRAM_ID,
  );

  return (program.methods as any)
    .genesisDeposit(new BN(ctx.vaultId), baselineSharePrice)
    .accounts({
      globalState: deriveGlobalStatePda(),
      vault: ctx.vaultPda,
      usdcMint: ctx.baseMint,
      vaultAuthority: ctx.vaultAuthority,
      usdcVault: ctx.usdcVault,
      shareMint: ctx.sharesMint,
      authorityUsdcAccount: authorityUsdc,
      vaultShareAccount,
      authority,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      baseTokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    } as never)
    .remainingAccounts(
      ctx.assets.map((a) => ({
        pubkey: a.assetInfoPda,
        isSigner: false,
        isWritable: false,
      })),
    )
    .instruction();
}

/**
 * One-time genesis seed + inflow deploy in ONE v0 transaction (mirrors
 * `depositAndDeploy`): `[ensure vault ATAs, ensure signer ATAs, genesis_deposit,
 * swap legs]`. Admin or vault manager only (enforced on-chain); callable once
 * per vault while `total_shares == 0`.
 */
export async function genesisDepositAndDeploy(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  baselineSharePrice: BN,
  altAddress: string | null | undefined,
  network: Network,
  onProgress?: ProgressFn,
): Promise<{ tx: string; link: string; signatures: string[] } & VaultAltResult> {
  const program = createProgram(wallet, connection);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  await prepareSwapPreflight(connection, wallet, program, network, ctx, onProgress);
  // Hard guarantee: reuse live ALT or create a new one. Swap legs and
  // genesis_deposit need the LUT when split; ATA-create txs stay static-key.
  const ensured = await ensureVaultAlt(connection, wallet, ctx, altAddress, onProgress);

  const signerAtaIxs = buildSignerAtaIxs(ctx, wallet.publicKey);
  const genesisIx = await buildGenesisDepositIx(
    program,
    ctx,
    wallet.publicKey,
    baselineSharePrice,
  );
  const swapIxs = await buildInflowSwapIxs(connection, program, ctx, wallet.publicKey);

  let signatures: string[];
  if (needsMultiTxBundle(ctx)) {
    const vaultAtaIxs = await buildMissingVaultAtaIxs(connection, wallet.publicKey, ctx);
    signatures = await sendGenesisBundle(
      connection,
      wallet,
      vaultAtaIxs,
      signerAtaIxs,
      genesisIx,
      swapIxs,
      ensured.lut,
      network,
      onProgress,
    );
  } else {
    const vaultAtaIxs = ensureVaultAssetAtaIxs(wallet.publicKey, ctx);
    onProgress?.('Sending genesis_deposit transaction…');
    const sig = await sendV0(
      connection,
      wallet,
      [...vaultAtaIxs, ...signerAtaIxs, genesisIx, ...swapIxs],
      ensured.lut,
    );
    signatures = [sig];
  }

  const tx = signatures[signatures.length - 1]!;
  return {
    tx,
    link: solscanLink(tx, network),
    signatures,
    altAddress: ensured.altAddress,
    altCreated: ensured.altCreated,
  };
}

/**
 * Deploy whatever inflow is pending for a vault (Vault Ops panel, Plan.md §1-2).
 * Permissionless — any connected wallet may run the conversion.
 */
export async function deployPendingSwaps(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  altAddress: string | null | undefined,
  network: Network,
  onProgress?: ProgressFn,
): Promise<
  { tx: string; link: string; signatures: string[]; pendingUsdc: string; pendingSol: string } & VaultAltResult
> {
  const program = createProgram(wallet, connection);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  await prepareSwapPreflight(connection, wallet, program, network, ctx, onProgress);
  const vault = await fetchDecodedVault(connection, ctx.vaultPda);
  if (!vault) {
    throw await formatVaultMissingError(connection, vaultId, ctx.vaultPda);
  }
  const pendingUsdc = BigInt(vault.totalPendingUsdc.toString());
  const pendingSol = BigInt(vault.totalPendingSol.toString());
  if (pendingUsdc === 0n && pendingSol === 0n) {
    throw new Error('Nothing pending to deploy — deposit first.');
  }

  const ensured = await ensureVaultAlt(connection, wallet, ctx, altAddress, onProgress);
  const swapIxs = await buildInflowSwapIxs(connection, program, ctx, wallet.publicKey, {
    includeUsdcToSol: pendingUsdc > 0n,
  });

  let signatures: string[];
  if (needsMultiTxBundle(ctx)) {
    if (swapIxs.length === 0) {
      throw new Error('No inflow swap instructions to deploy.');
    }
    const vaultAtaIxs = await buildMissingVaultAtaIxs(connection, wallet.publicKey, ctx);
    // Setup + inflow swaps: one signAllTransactions popup, sequential plain RPC.
    const setupBatches = chunkIxs(vaultAtaIxs, VAULT_ATA_IXS_PER_TX);
    const swapBatches = packIxsForAlt(wallet.publicKey, swapIxs, ensured.lut);
    const allBatches = [...setupBatches, ...swapBatches];
    onProgress?.(
      `${ctx.numAssets} assets (> ${MULTI_TX_ASSET_THRESHOLD}) — ` +
        `${vaultAtaIxs.length} ATA ix(s) + ${swapIxs.length} inflow swap(s) → ` +
        `${allBatches.length} ALT tx(s), one wallet approval…`,
    );
    signatures = await signAndSendV0Batches(
      connection,
      wallet,
      allBatches,
      ensured.lut,
      onProgress,
    );
  } else {
    const vaultAtaIxs = ensureVaultAssetAtaIxs(wallet.publicKey, ctx);
    const sig = await sendV0(connection, wallet, [...vaultAtaIxs, ...swapIxs], ensured.lut);
    signatures = [sig];
  }

  const tx = signatures[signatures.length - 1]!;
  return {
    tx,
    link: solscanLink(tx, network),
    signatures,
    pendingUsdc: pendingUsdc.toString(),
    pendingSol: pendingSol.toString(),
    altAddress: ensured.altAddress,
    altCreated: ensured.altCreated,
  };
}

interface RawRedeemState {
  isRedeemActive: boolean;
  numAssets: number;
  assetAmountIn: BN[];
  assetSwapped: boolean[];
  assetToSolDone: boolean[];
  wsolReceived: BN[];
}

async function tryFetchRedeemState(
  program: ReturnType<typeof createProgram>,
  user: PublicKey,
  vaultId: number,
): Promise<RawRedeemState | null> {
  try {
    const raw = await (program.account as any).redeemState.fetch(
      deriveRedeemStatePda(user, vaultId),
    );
    // Normalize camelCase / snake_case so resume logic never sees undefined flags.
    const d = raw as Record<string, unknown>;
    const pick = <T,>(camel: string, snake: string): T => (d[camel] ?? d[snake]) as T;
    return {
      isRedeemActive: Boolean(pick<boolean>('isRedeemActive', 'is_redeem_active')),
      numAssets: Number(pick<number>('numAssets', 'num_assets') ?? 0),
      assetAmountIn: pick<BN[]>('assetAmountIn', 'asset_amount_in') ?? [],
      assetSwapped: pick<boolean[]>('assetSwapped', 'asset_swapped') ?? [],
      assetToSolDone: pick<boolean[]>('assetToSolDone', 'asset_to_sol_done') ?? [],
      wsolReceived: pick<BN[]>('wsolReceived', 'wsol_received') ?? [],
    };
  } catch {
    return null;
  }
}

/** USDC base units sitting in this user's per-vault redeem escrow (C-03). */
async function fetchRedeemUsdcBalance(
  connection: Connection,
  user: PublicKey,
  vaultId: number,
): Promise<bigint> {
  const redeemUsdc = deriveRedeemUsdcPda(user, vaultId);
  try {
    const bal = await connection.getTokenAccountBalance(redeemUsdc);
    return BigInt(bal.value.amount);
  } catch {
    return 0n;
  }
}

export interface RedeemClaimResult {
  /** 'requested' — shares burned, not yet claimed; 'claimed' — payout sent. */
  phase: 'requested' | 'claimed';
  signatures: string[];
  link: string;
}

export interface RedeemSwapResult {
  /** Outflow legs ran to completion; call `claim` next. No cooldown exists
   *  on-chain — `redeemSwap` always runs request_redeem (if needed) then
   *  every outflow leg in the same call. */
  phase: 'swapped';
  signatures: string[];
  link: string;
  altAddress?: string;
  altCreated?: boolean;
}

type RedeemStateSnap = NonNullable<Awaited<ReturnType<typeof tryFetchRedeemState>>>;

export type RedeemSwapOptions = {
  /**
   * Append the `claim` instruction(s) to the same signed batch so the user
   * gets USDC in **one** wallet popup (burn + swaps + claim). Default false
   * keeps the old phase split for callers that claim separately.
   */
  includeClaim?: boolean;
};

/**
 * Phases 1-2 of redeem — and optionally phase 3 (`claim`):
 *
 *  1. No active redeem → verify share balance, build `request_redeem`
 *     (creates/reuses RedeemState + redeem_usdc escrow).
 *  2. Build all outflow legs. ViaSol leg-2 no longer takes a client-supplied
 *     wSOL amount — the program sells `RedeemState.wsol_received[i]` measured
 *     in leg-1. USDC-terminal legs credit the per-redeem escrow (C-03).
 *  3. Optional `claim` (when `includeClaim`) so USDC lands without a 2nd popup.
 *  4. **One wallet approval** via `signAllTransactions`, then land sequentially.
 */
export async function redeemSwap(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  shares: BN | null,
  altAddress: string | null | undefined,
  network: Network,
  onProgress?: ProgressFn,
  options?: RedeemSwapOptions,
): Promise<RedeemSwapResult> {
  const includeClaim = options?.includeClaim === true;
  const program = createProgram(wallet, connection);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  await prepareSwapPreflight(connection, wallet, program, network, ctx, onProgress);
  const ensured = await ensureVaultAlt(connection, wallet, ctx, altAddress, onProgress);
  const lut = ensured.lut;
  const user = wallet.publicKey;

  const redeemState = await tryFetchRedeemState(program, user, vaultId);
  const needsBurn = !redeemState || !redeemState.isRedeemActive;

  // ── Phase 1: burn ixs (not sent yet) ─────────────────────────────────────
  let burnIxs: TransactionInstruction[] = [];
  if (needsBurn) {
    if (!shares || shares.isZero()) throw new Error('Enter shares to redeem.');
    const userShares = getAssociatedTokenAddressSync(
      ctx.sharesMint, user, false, TOKEN_2022_PROGRAM_ID,
    );
    let balance = 0n;
    try {
      balance = BigInt((await connection.getTokenAccountBalance(userShares)).value.amount);
    } catch {
      // no share account — balance stays 0
    }
    if (balance < BigInt(shares.toString())) {
      throw new Error(
        `Insufficient shares: you hold ${balance}, tried to redeem ${shares}.`,
      );
    }
    burnIxs = await buildRequestRedeemIxs(program, ctx, user, shares);
  }

  if (!needsBurn && !redeemState) {
    throw new Error('RedeemState missing while redeem is marked active.');
  }

  type OutflowItem = { index: number; label: string; ix: TransactionInstruction };
  const outflowItems: OutflowItem[] = [];

  const numAssets = needsBurn
    ? ctx.numAssets
    : (redeemState as RedeemStateSnap).numAssets;

  // Cache vault decode for off-chain amount estimates (fresh burn only).
  let vaultForEstimate: DecodedVault | null = null;
  if (needsBurn) {
    vaultForEstimate = await fetchDecodedVault(connection, ctx.vaultPda);
    if (!vaultForEstimate) {
      throw new Error('Vault account missing — cannot estimate redeem amounts.');
    }
  }

  for (let i = 0; i < numAssets; i++) {
    if (!needsBurn) {
      const state = redeemState as RedeemStateSnap;
      if (state.assetSwapped[i]) continue;
      const amountIn = new BN(state.assetAmountIn[i]?.toString() ?? '0');
      if (amountIn.isZero()) continue;
    }

    const asset = assetAt(ctx, i);

    // Native wSOL ViaSol — leg-2 only (program uses asset_amount_in / wsol_received).
    if (asset.mint.equals(WSOL_MINT) && asset.route === 'ViaSol') {
      if (needsBurn) {
        const wsolIn = await estimateRedeemAssetAmount(
          connection, ctx, i, shares as BN, vaultForEstimate!,
        );
        if (wsolIn.isZero()) continue;
      }
      outflowItems.push({
        index: i,
        label: `wSOL-native slot ${i + 1}`,
        ix: await buildSwapSolToUsdcIx(
          connection, program, ctx, i, new BN(0), user,
        ),
      });
      continue;
    }

    if (asset.route === 'ViaSol') {
      const leg1Done = !needsBurn && Boolean(
        (redeemState as RedeemStateSnap).assetToSolDone?.[i],
      );

      if (needsBurn) {
        const amt = await estimateRedeemAssetAmount(
          connection, ctx, i, shares as BN, vaultForEstimate!,
        );
        if (amt.isZero()) continue;
      }

      if (!leg1Done) {
        // Leg-1: asset → vault wSOL (measured into RedeemState.wsol_received).
        outflowItems.push({
          index: i,
          label: `asset→wSOL slot ${i + 1}`,
          ix: await buildSwapAssetToSolIx(
            connection, program, ctx, i, user, new BN(0),
          ),
        });
      }

      // Leg-2: program sells measured wsol_received[i] into redeem_usdc.
      outflowItems.push({
        index: i,
        label: `wSOL→USDC asset ${i + 1}`,
        ix: await buildSwapSolToUsdcIx(
          connection, program, ctx, i, new BN(0), user,
        ),
      });
      continue;
    }

    if (asset.route === 'DirectUsdc') {
      if (needsBurn) {
        const amt = await estimateRedeemAssetAmount(
          connection, ctx, i, shares as BN, vaultForEstimate!,
        );
        if (amt.isZero()) continue;
      }
      outflowItems.push({
        index: i,
        label: `DirectUsdc asset ${i + 1}`,
        ix: await buildSwapAssetToUsdcIx(
          connection, program, ctx, i, user, new BN(0),
        ),
      });
    }
  }

  let claimIxs: TransactionInstruction[] = [];
  if (includeClaim) {
    claimIxs = await buildClaimIxs(connection, program, ctx, user);
  }

  // Ordered payload: burn → outflow legs (leg-1 before leg-2 for each ViaSol) → claim.
  const coreIxs: TransactionInstruction[] = [
    ...burnIxs,
    ...outflowItems.map((b) => b.ix),
    ...claimIxs,
  ];

  const signatures: string[] = [];

  if (coreIxs.length > 0) {
    const batches = packIxsForAlt(user, coreIxs, lut);
    onProgress?.(
      `Redeem: ${burnIxs.length ? 'burn + ' : ''}` +
        `${outflowItems.length} outflow leg(s)` +
        `${claimIxs.length ? ' + claim' : ''} → ` +
        `${batches.length} ALT tx(s), one wallet approval…`,
    );
    try {
      signatures.push(
        ...(await signAndSendV0Batches(
          connection,
          wallet,
          batches,
          lut,
          onProgress,
        )),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Redeem outflow failed: ${msg}\n` +
          `Press Redeem (swap) again to resume remaining legs. Do not start a new redeem.`,
      );
    }
  }

  if (includeClaim) {
    onProgress?.('Redeem + claim complete.');
    return {
      phase: 'swapped',
      signatures,
      link: solscanLink(signatures[signatures.length - 1] ?? '', network),
      altAddress: ensured.altAddress,
      altCreated: ensured.altCreated,
    };
  }

  // Hard check: claim requires redeem_usdc balance > 0 and all legs swapped.
  const finalState = await tryFetchRedeemState(program, user, vaultId);
  if (!finalState) {
    throw new Error('RedeemState missing after swaps — cannot claim.');
  }
  const pending = await fetchRedeemUsdcBalance(connection, user, vaultId);
  const unswapped: number[] = [];
  for (let i = 0; i < finalState.numAssets; i++) {
    const amt = BigInt(finalState.assetAmountIn[i]?.toString() ?? '0');
    if (amt > 0n && !finalState.assetSwapped[i]) unswapped.push(i);
  }
  if (unswapped.length > 0) {
    throw new Error(
      `Outflow incomplete — still unswapped asset slots: [${unswapped.map((i) => i + 1).join(', ')}]. ` +
        (pending > 0n
          ? `Partial USDC already in escrow (${pending} raw) — do NOT claim yet (claim requires all legs swapped). Press Redeem (swap) again to finish remaining legs. `
          : `Press Redeem (swap) again to resume. `) +
        `Do not start a new redeem.`,
    );
  }
  if (pending <= 0n) {
    throw new Error(
      `Outflow finished with redeem USDC escrow = 0 (cannot claim). Vault may have held zero free balances at burn time.`,
    );
  }

  onProgress?.(`Outflow complete — ${pending} USDC raw in escrow ready to claim.`);

  return {
    phase: 'swapped',
    signatures,
    link: solscanLink(signatures[signatures.length - 1] ?? '', network),
    altAddress: ensured.altAddress,
    altCreated: ensured.altCreated,
  };
}

async function estimateRedeemAssetAmount(
  connection: Connection,
  ctx: VaultChainCtx,
  assetIndex: number,
  shares: BN,
  vault: DecodedVault,
): Promise<BN> {
  const totalShares = BigInt(vault.totalShares.toString());
  if (totalShares === 0n) return new BN(0);
  const sharesBn = BigInt(shares.toString());

  const asset = assetAt(ctx, assetIndex);
  let free = 0n;
  try {
    const bal = await connection.getTokenAccountBalance(asset.vaultAssetAtaKey);
    free = BigInt(bal.value.amount);
  } catch {
    free = 0n;
  }
  const reservedArr = vault.reservedAssets;
  if (reservedArr && reservedArr[assetIndex] != null) {
    const reserved = BigInt(reservedArr[assetIndex]!.toString());
    free = free > reserved ? free - reserved : 0n;
  }
  return new BN(((free * sharesBn) / totalShares).toString());
}

/**
 * Combined "Redeem & Claim" — burn + outflow + claim in **one** wallet popup
 * (`signAllTransactions`), then sequential plain-RPC landing.
 */
export async function redeemAndClaim(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  shares: BN | null,
  altAddress: string | null | undefined,
  network: Network,
  onProgress?: ProgressFn,
): Promise<RedeemClaimResult> {
  const swapResult = await redeemSwap(
    connection,
    wallet,
    vaultId,
    shares,
    altAddress,
    network,
    onProgress,
    { includeClaim: true },
  );
  return {
    phase: 'claimed',
    signatures: swapResult.signatures,
    link: swapResult.link,
  };
}

// ─── View functions ───────────────────────────────────────────────────────────

export interface GlobalStateView {
  isEmergency: boolean;
  totalVaults: string;
  treasuryAddr: string;
  /** ETF creation gate signer; default pubkey means gate disabled. */
  etfCreationAuthority: string;
  totalAssets: string;
}

export async function getGlobalState(connection: Connection): Promise<GlobalStateView> {
  const program = createProgram(createDummyWallet(), connection);
  const pda = deriveGlobalStatePda();
  const gs = await (program.account as any).globalState.fetch(pda);
  const etfAuth =
    (gs.etfCreationAuthority as PublicKey | undefined) ??
    (gs.etf_creation_authority as PublicKey | undefined) ??
    PublicKey.default;
  return {
    isEmergency: gs.isEmergency,
    totalVaults: gs.totalVaults.toString(),
    treasuryAddr: (gs.treasuryAddr as PublicKey).toBase58(),
    etfCreationAuthority: etfAuth.toBase58(),
    totalAssets: gs.totalAssets.toString(),
  };
}

export interface VaultStateView {
  address: string;
  vaultId: string;
  baseMint: string;
  feeRecipient: string;
  totalShares: string;
  totalPendingUsdc: string;
  totalPendingSol: string;
  depositFeeBps: number;
  redeemFeeBps: number;
  /** Genesis baseline share price (PRICE_SCALE). */
  baselineSharePrice: string;
  numAssets: number;
  /** Global asset ids in this vault's basket (may include ids whose AssetInfo is missing). */
  assetIds: number[];
  assetAllocationBps: number[];
  paused: boolean;
  adminLocked: boolean;
  /** On-chain `Vault.genesis_done` — true after genesis_deposit seeds the vault. */
  genesisDone: boolean;
  usdcSolPool: string | null;
}

/**
 * Read vault account fields only — does **not** require AssetInfo PDAs.
 * Use this for the View → Vault state panel so a broken basket still surfaces.
 *
 * Uses the hand-rolled zero-copy decoder (same as `fetchVaultCtx`).
 */
export async function getVaultState(
  connection: Connection,
  vaultId: number = DEFAULT_VAULT_ID,
  network: Network = 'mainnet',
): Promise<VaultStateView> {
  const { vaultPda } = deriveVaultPdas(vaultId, network);

  let vault: DecodedVault;
  try {
    const decoded = await fetchDecodedVault(connection, vaultPda);
    if (!decoded) {
      throw await formatVaultMissingError(connection, vaultId, vaultPda);
    }
    vault = decoded;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Vault ')) throw err;
    if (isAccountMissingError(err)) {
      throw await formatVaultMissingError(connection, vaultId, vaultPda);
    }
    throw err;
  }

  const numAssets = vault.numAssets;
  const assetIds = vault.assetIds.slice(0, numAssets).map((id) => id.toNumber());
  const assetAllocationBps = vault.assetAllocationBps.slice(0, numAssets);

  return {
    address: vaultPda.toBase58(),
    vaultId: vault.vaultId.toString(),
    baseMint: NETWORK_CONSTANTS[network].usdcMint.toBase58(),
    feeRecipient: vault.feeRecipient.toBase58(),
    totalShares: vault.totalShares.toString(),
    totalPendingUsdc: vault.totalPendingUsdc.toString(),
    totalPendingSol: vault.totalPendingSol.toString(),
    depositFeeBps: vault.depositFeeBps,
    redeemFeeBps: vault.redeemFeeBps,
    baselineSharePrice: vault.baselineSharePrice.toString(),
    numAssets,
    assetIds,
    assetAllocationBps,
    paused: vault.paused !== 0,
    adminLocked: vault.adminLocked !== 0,
    genesisDone: vault.genesisDone !== 0,
    // Not stored on Vault anymore; ViaSol legs use the cluster canonical pool.
    usdcSolPool: null,
  };
}

export interface NavView {
  /** Human-readable portfolio value, e.g. `$12.34`. */
  totalNavUsd: string;
  /** Human-readable USDC per share, e.g. `$1.00`. */
  sharePriceUsd: string;
  /** Human-readable outstanding share supply. */
  totalSharesUi: string;
  /** Raw total NAV in USDC base units (6 decimals). */
  totalNav: string;
  /** Raw share price in PRICE_SCALE units (1e9). */
  sharePrice: string;
  /** Raw share supply (Token-2022 base units). */
  totalShares: string;
  sharesDecimals: number;
  /** Set when the vault is empty (NAV = 0) — explains the zero result. */
  note?: string;
}

/** Read a field from an Anchor `.view()` result under any of the given key aliases. */
function viewField(result: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (result[key] != null) return result[key];
  }
  return undefined;
}

function viewFieldToString(result: Record<string, unknown>, ...keys: string[]): string {
  const v = viewField(result, ...keys);
  if (v == null) {
    throw new Error(
      `NAV view missing field ${keys.join('/')}. Got: ${JSON.stringify(result, (_k, val) =>
        typeof val === 'bigint' ? val.toString() : val,
      )}`,
    );
  }
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'object' && v !== null && 'toString' in v) {
    return (v as { toString: () => string }).toString();
  }
  return String(v);
}

/**
 * Portfolio value field aliases across view return types:
 * - NavViewResult: `tvl`
 * - PreviewDepositResult: `total_nav` / `totalNav`
 * Older builds / mixed IDLs may use either.
 */
function viewNavAmountToString(result: Record<string, unknown>): string {
  return viewFieldToString(result, 'totalNav', 'total_nav', 'tvl');
}

/** Shares-mint decimals (Token-2022); falls back to 6 when unreadable. */
async function fetchSharesDecimals(
  connection: Connection,
  ctx: VaultChainCtx,
): Promise<number> {
  try {
    const mintInfo = await getMint(connection, ctx.sharesMint, undefined, TOKEN_2022_PROGRAM_ID);
    return mintInfo.decimals;
  } catch {
    return 6;
  }
}

/** True when `err` is the program's ZeroAmount (6000 / 0x1770) rejection. */
function isZeroAmountError(err: unknown): boolean {
  const anchorCode = (err as { error?: { errorCode?: { number?: number } } })?.error?.errorCode
    ?.number;
  if (anchorCode === 6000) return true;
  if (/ZeroAmount/.test(parseTxError(err).code ?? '')) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /ZeroAmount|Error Number: 6000|custom program error: 0x1770/i.test(msg);
}

/**
 * `get_total_nav_view` hard-rejects `total_nav == 0` with ZeroAmount — for an
 * unfunded vault that is the expected state, not a failure. Surface it as a
 * $0.00 result with the real on-chain share supply and a next-step note.
 */
async function emptyVaultNavView(
  connection: Connection,
  ctx: VaultChainCtx,
  vaultId: number,
): Promise<NavView> {
  let totalShares = '0';
  try {
    const decoded = await fetchDecodedVault(connection, ctx.vaultPda);
    if (decoded) totalShares = decoded.totalShares.toString();
  } catch {
    // keep '0'
  }
  const sharesDecimals = await fetchSharesDecimals(connection, ctx);
  return {
    totalNavUsd: '$0.00',
    sharePriceUsd: '—',
    totalSharesUi: formatUnits(totalShares, sharesDecimals),
    totalNav: '0',
    sharePrice: '0',
    totalShares,
    sharesDecimals,
    note:
      `Vault ${vaultId} is empty — no asset balances and no pending USDC, so NAV is $0 ` +
      'and no share price exists yet. Fund it with Genesis deposit (Create · №01).',
  };
}

/**
 * Mainnet NAV computation: vault ATA balances × Jupiter USD prices, entirely
 * client-side — no transaction is built or simulated, so there is no
 * 1232-byte packet limit to hit regardless of basket size. See
 * docs/superpowers/specs/2026-07-31-jupiter-client-side-nav-design.md.
 *
 * Throws if Jupiter's response is missing a price for any non-quote asset
 * the vault holds a nonzero balance of (fetchUsdPrices already throws in
 * that case) — never silently substitutes $0.
 */
async function computeNavFromChain(
  connection: Connection,
  ctx: VaultChainCtx,
  vaultId: number,
): Promise<NavView> {
  const holdings = await fetchVaultAssetHoldings(connection, ctx);
  const decoded = await fetchDecodedVault(connection, ctx.vaultPda);
  const totalShares = decoded ? BigInt(decoded.totalShares.toString()) : 0n;
  const sharesDecimals = await fetchSharesDecimals(connection, ctx);

  if (totalShares === 0n) {
    return emptyVaultNavView(connection, ctx, vaultId);
  }

  const mintsToPrice = holdings
    .filter((h) => !h.isQuoteAsset && h.balanceRaw > 0n)
    .map((h) => h.mint);
  const prices = await fetchUsdPrices(mintsToPrice);

  const priced: PricedAsset[] = holdings.map((h) => ({
    ...h,
    priceScaled: h.isQuoteAsset
      ? null
      : h.balanceRaw > 0n
        ? priceToFixedPoint(prices.get(h.mint)!.usdPrice)
        : null, // zero-balance non-quote asset never needs a price
  }));

  const totalNav = totalUsdcValue(priced, USDC_DECIMALS).toString();
  const sharePrice = sharePriceRaw(BigInt(totalNav), totalShares).toString();
  const priceDecimals = Math.log10(PRICE_SCALE);

  return {
    totalNavUsd: `$${formatUnits(totalNav, USDC_DECIMALS)}`,
    sharePriceUsd: `$${formatUnits(sharePrice, priceDecimals)}`,
    totalSharesUi: formatUnits(totalShares.toString(), sharesDecimals),
    totalNav,
    sharePrice,
    totalShares: totalShares.toString(),
    sharesDecimals,
  };
}

/**
 * Live NAV view — raw on-chain units plus human-readable USD / share strings.
 * Mirrors `c_vault_script/lib/sdk/views.js` `getTotalNavView` formatting so the
 * UI does not dump opaque raw integers (or empty) in the OUTPUT panel.
 *
 * Pass `wallet` when available: missing vault ATAs are simulated as
 * preInstructions. Views use on-chain spot pricing (`use_spot`) — stale
 * DEX assets price at live pool spot (same basis as deposit).
 *
 * On mainnet, NAV is computed client-side from vault ATA balances × Jupiter
 * USD prices (no transaction simulation — no 1232-byte limit). Localhost
 * keeps the on-chain `.view()` path so Surfpool synthetic mints still price.
 */
export async function getTotalNavView(
  connection: Connection,
  vaultId: number = DEFAULT_VAULT_ID,
  network: Network = 'mainnet',
  wallet?: AnchorWallet | null,
): Promise<NavView> {
  const ctx = await fetchVaultCtx(connection, vaultId, network);

  if (network === 'mainnet') {
    return computeNavFromChain(connection, ctx, vaultId);
  }

  const program = createProgram(wallet ?? createDummyWallet(), connection);
  const preIxs = await prepareViewAccounts(connection, network, ctx, wallet);

  let raw: Record<string, unknown>;
  try {
    raw = await (program.methods as any)
      .getTotalNavView(new BN(vaultId))
      .accounts({
        globalState: deriveGlobalStatePda(),
        vault: ctx.vaultPda,
        vaultAuthority: ctx.vaultAuthority,
      } as never)
      .remainingAccounts(await navRemainingAccounts(connection, ctx))
      .preInstructions(preIxs)
      .view();
  } catch (err) {
    if (isZeroAmountError(err)) {
      return emptyVaultNavView(connection, ctx, vaultId);
    }
    const missing = await diagnoseMissingNavAccounts(connection, ctx, {
      ignoreAtas: preIxs.length > 0,
    }).catch(() => [] as string[]);
    if (missing.length > 0) {
      throw new Error(
        `Missing on-chain accounts for NAV: ${missing.join('; ')}. ` +
          (wallet
            ? 'These accounts must exist on-chain before the view can run.'
            : 'Connect a wallet and retry — the view simulates the ATA creation (gasless, nothing is sent on-chain).'),
      );
    }
    throw err;
  }

  if (raw == null || typeof raw !== 'object') {
    throw new Error(
      `Live NAV returned no data (got ${String(raw)}). Check vault ${vaultId} exists and oracles are fresh.`,
    );
  }

  const totalNav = viewNavAmountToString(raw);
  const sharePrice = viewFieldToString(raw, 'sharePrice', 'share_price');
  const totalShares = viewFieldToString(raw, 'totalShares', 'total_shares');

  const sharesDecimals = await fetchSharesDecimals(connection, ctx);

  // totalNav = 6-dec USDC; sharePrice = USDC/share with PRICE_SCALE (1e9);
  // totalShares = Token-2022 raw amount.
  const priceDecimals = Math.log10(PRICE_SCALE);
  return {
    totalNavUsd: `$${formatUnits(totalNav, USDC_DECIMALS)}`,
    sharePriceUsd: `$${formatUnits(sharePrice, priceDecimals)}`,
    totalSharesUi: formatUnits(totalShares, sharesDecimals),
    totalNav,
    sharePrice,
    totalShares,
    sharesDecimals,
  };
}

/**
 * Share price used to seed a secondary market (e.g. DAMM share/USDC pool).
 *
 * Prefer live oracle NAV via `get_total_nav_view`. If that fails or returns 0,
 * fall back to genesis `baseline_share_price`. The on-chain book counter
 * (`total_usdc_value`) was removed in 2.0.2 — never invent a $1 default.
 */
export type SharePriceSource = 'live_nav' | 'baseline';

export interface SharePriceQuote {
  /** PRICE_SCALE (1e9) raw units — same as NavView.sharePrice. */
  sharePrice: string;
  /** Human `$x.xx` for UI. */
  sharePriceUsd: string;
  source: SharePriceSource;
  /** Short label for the Init price field. */
  sourceLabel: string;
  totalShares: string;
  /** Present for live path — NAV TVL in USDC base units. */
  totalUsdcValue?: string;
  note?: string;
}

function formatSharePriceUsd(sharePriceRaw: string): string {
  return `$${formatUnits(sharePriceRaw, PRICE_SCALE_DECIMALS)}`;
}

/**
 * @deprecated On-chain book value counter removed (Audit L-01). Kept as a pure
 * helper for off-chain NAV × shares math only — do not read from Vault account.
 */
export function bookSharePriceRaw(totalUsdcValue: bigint, totalShares: bigint): bigint {
  if (totalShares <= 0n || totalUsdcValue <= 0n) return 0n;
  return (totalUsdcValue * BigInt(PRICE_SCALE)) / totalShares;
}

export async function getVaultSharePriceQuote(
  connection: Connection,
  vaultId: number = DEFAULT_VAULT_ID,
  network: Network = 'mainnet',
  wallet?: AnchorWallet | null,
): Promise<SharePriceQuote> {
  let liveError: string | null = null;

  try {
    const nav = await getTotalNavView(connection, vaultId, network, wallet);
    if (nav.sharePrice !== '0' && BigInt(nav.sharePrice) > 0n) {
      return {
        sharePrice: nav.sharePrice,
        sharePriceUsd: nav.sharePriceUsd.startsWith('$')
          ? nav.sharePriceUsd
          : formatSharePriceUsd(nav.sharePrice),
        source: 'live_nav',
        sourceLabel: 'live NAV',
        totalShares: nav.totalShares,
        totalUsdcValue: nav.totalNav !== '0' ? nav.totalNav : undefined,
      };
    }
    liveError =
      nav.note ??
      'Live NAV returned $0 (vault empty or no priced assets yet).';
  } catch (err) {
    liveError = err instanceof Error ? err.message : String(err);
  }

  // Baseline from the vault account — no simulation, no oracles.
  const { vaultPda } = deriveVaultPdas(vaultId, network);
  const decoded = await fetchDecodedVault(connection, vaultPda);
  if (!decoded) {
    throw new Error(
      liveError
        ? `Live NAV failed (${liveError.slice(0, 160)}) and vault ${vaultId} is not on-chain.`
        : `Vault ${vaultId} not found on-chain.`,
    );
  }

  const totalShares = BigInt(decoded.totalShares.toString());
  const baseline = BigInt(decoded.baselineSharePrice.toString());
  if (baseline > 0n) {
    const sharePrice = baseline.toString();
    return {
      sharePrice,
      sharePriceUsd: formatSharePriceUsd(sharePrice),
      source: 'baseline',
      sourceLabel: 'genesis baseline',
      totalShares: totalShares.toString(),
      note: liveError
        ? `Using genesis baseline — live NAV unavailable: ${liveError.slice(0, 180)}`
        : 'Using genesis baseline (live NAV is zero).',
    };
  }

  throw new Error(
    (liveError ? `Live NAV: ${liveError.slice(0, 160)}. ` : '') +
      `Vault ${vaultId} has no usable share price yet (live NAV $0, baseline unset). ` +
      'Run Genesis deposit (№01) and wait for asset balances before creating a pool.',
  );
}

export interface PreviewDepositResult {
  sharesToMint: string;
  totalNav: string;
  sharePrice: string;
  totalShares: string;
}

export async function previewDeposit(
  connection: Connection,
  vaultId: number = DEFAULT_VAULT_ID,
  usdcAmount: BN,
  network: Network = 'mainnet',
  wallet?: AnchorWallet | null,
): Promise<PreviewDepositResult> {
  const ctx = await fetchVaultCtx(connection, vaultId, network);

  if (network === 'mainnet') {
    const nav = await computeNavFromChain(connection, ctx, vaultId);
    const usdcInRaw = BigInt(usdcAmount.toString());
    const sharesToMint = previewSharesToMint(usdcInRaw, BigInt(nav.sharePrice));
    return {
      sharesToMint: sharesToMint.toString(),
      totalNav: nav.totalNav,
      sharePrice: nav.sharePrice,
      totalShares: nav.totalShares,
    };
  }

  const program = createProgram(wallet ?? createDummyWallet(), connection);
  const preIxs = await prepareViewAccounts(connection, network, ctx, wallet);

  const result = await (program.methods as any)
    .previewDeposit(new BN(vaultId), usdcAmount)
    .accounts({
      globalState: deriveGlobalStatePda(),
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
    } as never)
    .remainingAccounts(await navRemainingAccounts(connection, ctx))
    .preInstructions(preIxs)
    .view();

  return {
    sharesToMint: viewFieldToString(result, 'sharesToMint', 'shares_to_mint'),
    totalNav: viewNavAmountToString(result),
    sharePrice: viewFieldToString(result, 'sharePrice', 'share_price'),
    totalShares: viewFieldToString(result, 'totalShares', 'total_shares'),
  };
}

export interface PreviewRedeemResult {
  numAssets: number;
  assetAmounts: string[];
  estimatedUsdcValue: string;
  totalShares: string;
}

export async function previewRedeem(
  connection: Connection,
  vaultId: number = DEFAULT_VAULT_ID,
  shares: BN,
  network: Network = 'mainnet',
  wallet?: AnchorWallet | null,
): Promise<PreviewRedeemResult> {
  const ctx = await fetchVaultCtx(connection, vaultId, network);

  if (network === 'mainnet') {
    const nav = await computeNavFromChain(connection, ctx, vaultId);
    const sharesInRaw = BigInt(shares.toString());
    const usdcOut = previewUsdcOut(sharesInRaw, BigInt(nav.sharePrice));
    return {
      numAssets: ctx.numAssets,
      // Aggregate estimate only — per-asset swap legs require simulation.
      assetAmounts: [],
      estimatedUsdcValue: usdcOut.toString(),
      totalShares: nav.totalShares,
    };
  }

  const program = createProgram(wallet ?? createDummyWallet(), connection);
  const preIxs = await prepareViewAccounts(connection, network, ctx, wallet);

  const result = await (program.methods as any)
    .previewRedeem(new BN(vaultId), shares)
    .accounts({
      globalState: deriveGlobalStatePda(),
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
    } as never)
    .remainingAccounts(await navRemainingAccounts(connection, ctx))
    .preInstructions(preIxs)
    .view();

  const assetAmountsRaw = viewField(result, 'assetAmounts', 'asset_amounts');
  const amounts = Array.isArray(assetAmountsRaw)
    ? assetAmountsRaw.map((a) =>
        typeof a === 'object' && a !== null && 'toString' in a
          ? (a as { toString: () => string }).toString()
          : String(a),
      )
    : [];

  const numAssetsRaw = viewField(result, 'numAssets', 'num_assets');
  return {
    numAssets:
      typeof numAssetsRaw === 'number'
        ? numAssetsRaw
        : Number(numAssetsRaw ?? amounts.length),
    assetAmounts: amounts,
    estimatedUsdcValue: viewFieldToString(result, 'estimatedUsdcValue', 'estimated_usdc_value'),
    totalShares: viewFieldToString(result, 'totalShares', 'total_shares'),
  };
}

export interface UserPosition {
  user: string;
  shareBalance: string;
  redeemState?: {
    isRedeemActive: boolean;
    /** USDC base units in the per-redeem escrow (`redeem_usdc` PDA). */
    pendingUsdc: string;
    numAssets: number;
    assetAmountIn: string[];
    assetSwapped: boolean[];
    assetToSolDone: boolean[];
  };
}

export async function getUserPosition(
  connection: Connection,
  vaultId: number = DEFAULT_VAULT_ID,
  user: PublicKey,
  network: Network = 'mainnet',
): Promise<UserPosition> {
  const program = createProgram(createDummyWallet(), connection);
  const { sharesMint } = deriveVaultPdas(vaultId, network);
  const userShareAta = getAssociatedTokenAddressSync(sharesMint, user, false, TOKEN_2022_PROGRAM_ID);

  let shareBalance = '0';
  try {
    const bal = await connection.getTokenAccountBalance(userShareAta);
    shareBalance = bal.value.amount;
  } catch {
    // ata may not exist
  }

  const redeem = await tryFetchRedeemState(program, user, vaultId);
  if (!redeem) {
    return { user: user.toBase58(), shareBalance };
  }

  // C-03: pending USDC lives as the real balance of redeem_usdc, not a field.
  const pendingUsdc = (await fetchRedeemUsdcBalance(connection, user, vaultId)).toString();

  return {
    user: user.toBase58(),
    shareBalance,
    redeemState: {
      isRedeemActive: redeem.isRedeemActive,
      pendingUsdc,
      numAssets: redeem.numAssets,
      assetAmountIn: redeem.assetAmountIn.map((a) => a.toString()),
      assetSwapped: redeem.assetSwapped,
      assetToSolDone: redeem.assetToSolDone,
    },
  };
}

/** Raw USDC base units held in the user's wallet (network's canonical USDC ATA). */
export async function getUserUsdcBalance(
  connection: Connection,
  user: PublicKey,
  network: Network = 'mainnet',
): Promise<string> {
  const usdcAta = getAssociatedTokenAddressSync(
    NETWORK_CONSTANTS[network].usdcMint,
    user,
    false,
    TOKEN_PROGRAM_ID,
  );
  try {
    const bal = await connection.getTokenAccountBalance(usdcAta);
    return bal.value.amount;
  } catch {
    return '0'; // ata may not exist
  }
}

/**
 * Every basket asset's vault-held balance, tagged with whether it's the
 * vault's quote asset (USDC — skip pricing) or needs a USD price. A missing
 * ATA (asset slot never funded) reads as a zero balance, matching
 * `vaultWsolBalance`'s existing precedent just below.
 */
async function fetchVaultAssetHoldings(
  connection: Connection,
  ctx: VaultChainCtx,
): Promise<AssetHolding[]> {
  const holdings: AssetHolding[] = [];
  for (const asset of ctx.assets.slice(0, ctx.numAssets)) {
    let balanceRaw = 0n;
    try {
      const bal = await connection.getTokenAccountBalance(asset.vaultAssetAtaKey);
      balanceRaw = BigInt(bal.value.amount);
    } catch {
      // ATA doesn't exist yet — asset slot never funded, balance is 0.
    }
    holdings.push({
      mint: asset.mint.toBase58(),
      balanceRaw,
      decimals: asset.decimals,
      isQuoteAsset: asset.mint.equals(ctx.baseMint),
    });
  }
  return holdings;
}

/** Raw wSOL balance of the vault's wSOL ATA — used to measure ViaSol leg output. */
export async function vaultWsolBalance(
  connection: Connection,
  ctx: VaultChainCtx,
): Promise<bigint> {
  try {
    const bal = await connection.getTokenAccountBalance(
      vaultAssetAta(ctx.vaultAuthority, WSOL_MINT),
    );
    return BigInt(bal.value.amount);
  } catch {
    return 0n;
  }
}

// ─── Human-readable ↔ raw token amounts ──────────────────────────────────────

/**
 * Convert a human-readable decimal string (e.g. "1.5", "100") into raw base
 * units for a mint with `decimals` decimals — exact integer math, no floats.
 * Throws on malformed input or more fractional digits than the mint allows.
 */
export function parseUnits(amount: string, decimals: number): BN {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid amount: "${amount}"`);
  }
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length > decimals) {
    throw new Error(`Too many decimal places — max ${decimals} for this token.`);
  }
  const padded = frac.padEnd(decimals, '0');
  const combined = `${whole}${padded}`.replace(/^0+(?=\d)/, '');
  return new BN(combined || '0');
}

/**
 * Convert a raw base-unit amount into a human-readable decimal string for a
 * mint with `decimals` decimals — exact string math, no floats. Trailing
 * fractional zeros are trimmed.
 */
export function formatUnits(raw: bigint | BN | string, decimals: number): string {
  // Token balances are non-negative; strip any stray sign defensively.
  const s = (typeof raw === 'string' ? raw : raw.toString()).replace(/^-/, '');
  if (decimals === 0) return s;
  const padded = s.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Resolve a mint's `decimals` from the chain (authoritative). Used when the
 * token registry doesn't carry the base mint. Reads the SPL Token mint account.
 */
export async function fetchMintDecimals(
  connection: Connection,
  mint: PublicKey,
): Promise<number> {
  const info = await getMint(connection, mint, undefined, TOKEN_PROGRAM_ID);
  return info.decimals;
}

/**
 * Turn a preview / NAV / send failure into a short operator-facing string.
 * Prefer {@link parseTxError} + ErrorModal for interactive UI.
 */
export function describePreviewError(err: unknown): string {
  const parsed = parseTxError(err);
  // AccountNotFound previews are common before first deposit — keep the older
  // softer copy when the structured parser only has a raw simulation line.
  const blob = parsed.details || parsed.raw;
  if (/AccountNotFound|Account does not exist/i.test(blob) && !/insufficient funds/i.test(blob)) {
    if (!/Missing on-chain accounts for/i.test(parsed.raw)) {
      return (
        "Vault asset ATAs or price feeds aren't on-chain yet. Connect a wallet and retry — " +
        'the view simulates the missing vault ATAs (gasless, nothing is sent on-chain). ' +
        'On localhost, also ensure Surfpool Pyth refresh works.'
      );
    }
  }
  return formatUserFacingError(err);
}

/** Same legibility helpers for send/preflight failures (deposit, redeem, admin txs). */
export const describeSimulationError = describePreviewError;

// ─── Live per-asset vault balances ───────────────────────────────────────────

export interface VaultAssetBalance {
  mint: string;
  decimals: number;
  /** Raw base-unit balance held in the vault's ATA (0 when the ATA is absent). */
  raw: string;
  /** Human-readable balance derived from `raw` and `decimals`. */
  uiAmount: string;
}

/**
 * Live token balance the vault holds for each of its assets. Reads each asset's
 * associated token account (vault_authority-owned) in one batched RPC call; a
 * missing/uninitialized ATA counts as 0. Amounts are converted to
 * human-readable form using each asset's on-chain `decimals`.
 */
export async function getVaultAssetBalances(
  connection: Connection,
  vaultId: number = DEFAULT_VAULT_ID,
  network: Network = 'mainnet',
): Promise<VaultAssetBalance[]> {
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const atas = ctx.assets.map((a) => a.vaultAssetAtaKey);
  const infos = await connection.getMultipleAccountsInfo(atas);

  return ctx.assets.map((asset, i) => {
    let raw = 0n;
    const info = infos[i];
    if (info) {
      try {
        raw = unpackAccount(atas[i], info, tokenProgramForTag(asset.tokenProgramTag)).amount;
      } catch {
        raw = 0n;
      }
    }
    return {
      mint: asset.mint.toBase58(),
      decimals: asset.decimals,
      raw: raw.toString(),
      uiAmount: formatUnits(raw, asset.decimals),
    };
  });
}
