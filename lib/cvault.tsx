'use client';

import { Buffer as NodeBuffer } from 'buffer';
if (typeof globalThis !== 'undefined' && !('Buffer' in globalThis)) {
  (globalThis as { Buffer?: typeof NodeBuffer }).Buffer = NodeBuffer;
}

import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createApproveInstruction,
  getMint,
  unpackAccount,
} from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import type { AnchorWallet } from '@solana/wallet-adapter-react';

import { solscanLink, type Network } from './solscanLink';
import { createProgram, createDummyWallet } from './program';
import { sendV0, fetchAlt } from './alt';
import {
  deriveGlobalStatePda,
  deriveAssetInfoPda,
  deriveVaultPdas,
  deriveUserInfoPda,
  deriveRedeemStatePda,
} from './pda';
import { fetchPoolCtx, ownerAccountsFor, type PoolCtx } from './whirlpool';
import { fetchDammPoolCtx, type DammPoolCtx } from './damm';
import {
  C_VAULT_PROGRAM_ID,
  ADMIN_PUBKEY,
  DEFAULT_VAULT_ID,
  USDC_MINT,
  WSOL_MINT,
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
} from './constants';

export {
  C_VAULT_PROGRAM_ID,
  ADMIN_PUBKEY,
  DEFAULT_VAULT_ID,
  USDC_MINT,
  WSOL_MINT,
  PRICE_SOURCE_PYTH,
  PRICE_SOURCE_DEX,
  TOKEN_PROGRAM_TAG_SPL,
  TOKEN_PROGRAM_TAG_TOKEN_2022,
  DAMM_V2_PROGRAM_ID,
  WHIRLPOOL_PROGRAM_ID,
  NETWORK_CONSTANTS,
};
export {
  deriveGlobalStatePda,
  deriveAssetInfoPda,
  deriveVaultPdas,
  deriveUserInfoPda,
  deriveRedeemStatePda,
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

export async function fetchVaultCtx(
  connection: Connection,
  vaultId: number,
  network: Network = 'mainnet',
): Promise<VaultChainCtx> {
  const program = createProgram(createDummyWallet(), connection, network);
  const { vaultPda, vaultAuthority, sharesMint, usdcVault } = deriveVaultPdas(vaultId, network);
  const vault = await (program.account as any).vault.fetch(vaultPda);

  // v2: the vault stores only asset ids + allocations; every other asset
  // attribute lives on the global admin-listed AssetInfo PDAs.
  const numAssets = vault.numAssets as number;
  const assetIds = (vault.assetIds as BN[])
    .slice(0, numAssets)
    .map((id) => id.toNumber());
  const allocationBps = (vault.assetAllocationBps as number[]).slice(0, numAssets);
  const ataAddresses = (vault.assetAtaAddress as PublicKey[]).slice(0, numAssets);

  const assetInfoPdas = assetIds.map((id) => deriveAssetInfoPda(id, network));
  const infos: (RawAssetInfo | null)[] = await (program.account as any).assetInfo.fetchMultiple(
    assetInfoPdas,
  );

  const assets: VaultChainAsset[] = infos.map((info, i) => {
    if (!info) {
      throw new Error(`AssetInfo ${assetIds[i]} not found for vault ${vaultId}.`);
    }
    return {
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
        ataAddresses[i] ?? vaultAssetAta(vaultAuthority, info.mint, info.tokenProgramTag),
    };
  });

  const usdcSolEnabled = (vault.usdcSolPoolEnabled as number | boolean) ?? 0;
  const usdcSolPoolPk = vault.usdcSolPool as PublicKey | undefined;
  const usdcSolPool =
    usdcSolEnabled && usdcSolPoolPk && !usdcSolPoolPk.equals(PublicKey.default)
      ? usdcSolPoolPk
      : null;

  return {
    vaultId,
    vaultPda,
    vaultAuthority,
    sharesMint,
    usdcVault,
    baseMint: NETWORK_CONSTANTS[network].usdcMint,
    usdcSolPool,
    feeRecipient: vault.feeRecipient as PublicKey,
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
export async function listAssets(
  connection: Connection,
  network: Network = 'mainnet',
): Promise<AssetInfoView[]> {
  const program = createProgram(createDummyWallet(), connection, network);
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

type AccountMeta = { pubkey: PublicKey; isSigner: boolean; isWritable: boolean };

function readonlyMetas(keys: PublicKey[]): AccountMeta[] {
  return keys.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }));
}

/** Leading AssetInfo PDA block every v2 vault instruction expects, ordered
 *  to match `Vault.asset_ids[0..num_assets]`. Deposit needs it writable —
 *  pricing persists TWAP mutations back onto the global AssetInfo PDAs. */
function assetInfoMetas(ctx: VaultChainCtx, writable = false): AccountMeta[] {
  return ctx.assets.map((a) => ({
    pubkey: a.assetInfoPda,
    isSigner: false,
    isWritable: writable,
  }));
}

/**
 * Variable-stride remaining_accounts for deposit / NAV / preview:
 * `[asset_info_0..N, asset_ata_0..N, then per asset:
 *   pyth feed | (dex pool [+ whirlpool vaults])]`.
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
      // DammV2: pool only
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

function baseAta(owner: PublicKey, baseMint: PublicKey = USDC_MINT): PublicKey {
  return getAssociatedTokenAddressSync(baseMint, owner, false, TOKEN_PROGRAM_ID);
}

async function fetchTreasury(connection: Connection, network: Network): Promise<PublicKey> {
  const program = createProgram(createDummyWallet(), connection, network);
  const gs = await (program.account as any).globalState.fetch(deriveGlobalStatePda(network));
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

function globalAdminAccounts(admin: PublicKey, network: Network) {
  return { globalState: deriveGlobalStatePda(network), admin } as Record<string, PublicKey>;
}

/** v2: no arguments — treasury defaults to the admin signer. */
export async function initGlobalState(
  connection: Connection,
  wallet: AnchorWallet,
  network: Network,
) {
  const program = createProgram(wallet, connection, network);
  return sendMethod(
    connection,
    wallet,
    (program.methods as any)
      .initGlobalState()
      .accounts({ authority: wallet.publicKey } as never),
    network,
  );
}

export async function setTwapKeeper(
  connection: Connection,
  wallet: AnchorWallet,
  keeper: PublicKey,
  network: Network,
) {
  const program = createProgram(wallet, connection, network);
  return sendMethod(
    connection,
    wallet,
    (program.methods as any)
      .setTwapKeeper(keeper)
      .accounts(globalAdminAccounts(wallet.publicKey, network) as never),
    network,
  );
}

/** Keeper-only: push a TWAP observation onto one DEX-priced global asset. */
export async function updateDexTwap(
  connection: Connection,
  wallet: AnchorWallet,
  assetId: number,
  twapLiveState: BN,
  network: Network,
) {
  const program = createProgram(wallet, connection, network);
  return sendMethod(
    connection,
    wallet,
    (program.methods as any)
      .updateDexTwap(new BN(assetId), twapLiveState)
      .accounts({
        globalState: deriveGlobalStatePda(network),
        assetInfo: deriveAssetInfoPda(assetId, network),
        payer: wallet.publicKey,
        keeper: wallet.publicKey,
      } as never),
    network,
  );
}

export async function updateTreasuryAddr(
  connection: Connection,
  wallet: AnchorWallet,
  treasury: PublicKey,
  network: Network,
) {
  const program = createProgram(wallet, connection, network);
  return sendMethod(
    connection,
    wallet,
    (program.methods as any)
      .updateTreasuryAddr(treasury)
      .accounts(globalAdminAccounts(wallet.publicKey, network) as never),
    network,
  );
}

export async function setEmergency(
  connection: Connection,
  wallet: AnchorWallet,
  isEmergency: boolean,
  network: Network,
) {
  const program = createProgram(wallet, connection, network);
  return sendMethod(
    connection,
    wallet,
    (program.methods as any)
      .setEmergency(isEmergency)
      .accounts(globalAdminAccounts(wallet.publicKey, network) as never),
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
 * Admin-only: list a new global asset. `asset_id` is assigned from
 * `global_state.total_assets`, fetched here so the caller doesn't have to.
 * DEX-priced assets need the price pool (+ Whirlpool token vaults A/B) as
 * remaining_accounts, mirroring `create_etf`'s DEX remaining-accounts shape.
 */
export async function createAsset(
  connection: Connection,
  wallet: AnchorWallet,
  params: CreateAssetParams,
  network: Network,
): Promise<{ tx: string; link: string; assetId: number; decimals: number }> {
  const program = createProgram(wallet, connection, network);
  const gs = await (program.account as any).globalState.fetch(deriveGlobalStatePda(network));
  const assetId = (gs.totalAssets as BN).toNumber();
  const assetInfo = deriveAssetInfoPda(assetId, network);
  const mintInfo = await getMint(
    connection,
    params.mint,
    undefined,
    tokenProgramForTag(params.tokenProgramTag),
  );

  const remaining: AccountMeta[] = [];
  if (params.priceSourceTag === PRICE_SOURCE_DEX) {
    remaining.push({ pubkey: params.pricePoolAddress, isSigner: false, isWritable: false });
    if ('whirlpool' in params.swapKind) {
      const pool = await fetchPoolCtx(connection, params.pricePoolAddress);
      remaining.push(
        { pubkey: pool.info.tokenVaultA, isSigner: false, isWritable: false },
        { pubkey: pool.info.tokenVaultB, isSigner: false, isWritable: false },
      );
    }
  }

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
        globalState: deriveGlobalStatePda(network),
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
  const program = createProgram(wallet, connection, network);
  return sendMethod(
    connection,
    wallet,
    (program.methods as any)
      .setAssetActive(new BN(assetId), active)
      .accounts({
        assetInfo: deriveAssetInfoPda(assetId, network),
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
  const program = createProgram(wallet, connection, network);
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
  const program = createProgram(wallet, connection, network);
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
  const program = createProgram(wallet, connection, network);
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
  usdcSolPool: PublicKey | null;
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
 * Runs create_etf, which also initializes the share mint's Token-2022
 * metadata (name/symbol/uri) inside the same instruction — one signature,
 * one transaction. Returns the assigned vault id and PDAs so the caller can
 * record the vault off-chain.
 *
 * Quote mint is always mainnet USDC (program constant). remaining_accounts is
 * one AssetInfo PDA per `params.assets` entry, in order — every other asset
 * config (mint/pool/pricing/route/swap venue) already lives on that shared,
 * admin-listed AssetInfo (see `createAsset`).
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
  const program = createProgram(wallet, connection, network);

  // The program assigns vault_id = global_state.total_vaults at execution.
  const gs = await (program.account as any).globalState.fetch(deriveGlobalStatePda(network));
  const vaultId = (gs.totalVaults as BN).toNumber();

  const remaining: AccountMeta[] = params.assets.map((a) => ({
    pubkey: deriveAssetInfoPda(a.assetId, network),
    isSigner: false,
    isWritable: false,
  }));

  const ixParams = {
    feeRecipient: params.feeRecipient,
    depositFeeBps: params.depositFeeBps,
    redeemFeeBps: params.redeemFeeBps,
    usdcSolPool: params.usdcSolPool,
    assets: params.assets.map((a) => ({
      assetId: new BN(a.assetId),
      allocationBps: a.allocationBps,
    })),
    fundType: params.fundType,
    maxShares: params.maxShares,
  };

  // Build the instruction and send it through sendV0 rather than Anchor's
  // `.rpc()`: `.rpc()` confirms via the websocket subscription with a hard 30s
  // cap, which the public devnet RPC trips even when the tx lands ("not
  // confirmed / unknown if it succeeded"). sendV0 polls signature status.
  const createIx = await (program.methods as any)
    .createEtf(ixParams, name, symbol, uri)
    .accounts({
      authority: wallet.publicKey,
      usdcMint: NETWORK_CONSTANTS[network].usdcMint,
      sharesTokenProgram: TOKEN_2022_PROGRAM_ID,
    } as never)
    .remainingAccounts(remaining)
    .instruction();

  const sig = await sendV0(connection, wallet, [createIx]);

  const pdas = deriveVaultPdas(vaultId, network);
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
  network: Network,
): Promise<TransactionInstruction[]> {
  const userBase = baseAta(user, ctx.baseMint);
  const userShares = getAssociatedTokenAddressSync(
    ctx.sharesMint, user, false, TOKEN_2022_PROGRAM_ID,
  );
  const userInfo = deriveUserInfoPda(ctx.vaultPda, user, network);
  const treasury = await fetchTreasury(connection, network);

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
      globalState: deriveGlobalStatePda(network),
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
      userInfo,
      treasury,
      feeRecipient: ctx.feeRecipient,
      treasuryUsdcAccount: baseAta(treasury, ctx.baseMint),
      feeRecipientUsdcAccount: baseAta(ctx.feeRecipient, ctx.baseMint),
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    } as never)
    .remainingAccounts(await navRemainingAccounts(connection, ctx))
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
  const program = createProgram(wallet, connection, network);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const ixs = await buildDepositIxs(
    connection, program, ctx, wallet.publicKey, usdcAmount, minSharesOut, network,
  );
  const sig = await sendV0(connection, wallet, ixs);
  return { tx: sig, link: solscanLink(sig, network) };
}

/**
 * `[approve, request_redeem]` — the program burns shares with vault_authority
 * as the token authority, so the user must delegate `shares` to it first.
 */
async function buildRequestRedeemIxs(
  program: ReturnType<typeof createProgram>,
  ctx: VaultChainCtx,
  user: PublicKey,
  shares: BN,
  network: Network,
): Promise<TransactionInstruction[]> {
  const userShares = getAssociatedTokenAddressSync(
    ctx.sharesMint, user, false, TOKEN_2022_PROGRAM_ID,
  );
  const approveIx = createApproveInstruction(
    userShares,
    ctx.vaultAuthority,
    user,
    BigInt(shares.toString()),
    [],
    TOKEN_2022_PROGRAM_ID,
  );
  const redeemIx = await (program.methods as any)
    .requestRedeem(new BN(ctx.vaultId), shares)
    .accounts({
      globalState: deriveGlobalStatePda(network),
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
      sharesMint: ctx.sharesMint,
      userShareAccount: userShares,
      redeemState: deriveRedeemStatePda(user, ctx.vaultId, network),
      userInfo: deriveUserInfoPda(ctx.vaultPda, user, network),
      user,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as never)
    .remainingAccounts(assetAtaRemainingAccounts(ctx))
    .instruction();
  return [approveIx, redeemIx];
}

export async function requestRedeem(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  shares: BN,
  network: Network,
) {
  const program = createProgram(wallet, connection, network);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const ixs = await buildRequestRedeemIxs(program, ctx, wallet.publicKey, shares, network);
  const sig = await sendV0(connection, wallet, ixs);
  return { tx: sig, link: solscanLink(sig, network) };
}

async function buildClaimIxs(
  connection: Connection,
  program: ReturnType<typeof createProgram>,
  ctx: VaultChainCtx,
  user: PublicKey,
  network: Network,
): Promise<TransactionInstruction[]> {
  const userBase = baseAta(user, ctx.baseMint);
  const treasury = await fetchTreasury(connection, network);

  const ensureUserBaseIx = createAssociatedTokenAccountIdempotentInstruction(
    user, userBase, user, ctx.baseMint, TOKEN_PROGRAM_ID,
  );
  const claimIx = await (program.methods as any)
    .claim(new BN(ctx.vaultId))
    .accounts({
      globalState: deriveGlobalStatePda(network),
      vault: ctx.vaultPda,
      usdcMint: ctx.baseMint,
      vaultAuthority: ctx.vaultAuthority,
      redeemState: deriveRedeemStatePda(user, ctx.vaultId, network),
      usdcVault: ctx.usdcVault,
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
  const program = createProgram(wallet, connection, network);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const ixs = await buildClaimIxs(connection, program, ctx, wallet.publicKey, network);
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
  // Mix of readonly / writable — mark vaults and owner ATAs writable.
  const writable = new Set([
    owners.ownerA.toBase58(),
    owners.ownerB.toBase58(),
    pool.info.tokenVaultA.toBase58(),
    pool.info.tokenVaultB.toBase58(),
    pool.address.toBase58(),
    pool.tickArrays[0].toBase58(),
    pool.tickArrays[1].toBase58(),
    pool.tickArrays[2].toBase58(),
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

  return (program.methods as any)
    .swapUsdcToSol(new BN(ctx.vaultId), minWsolOut, aToB)
    .accounts({
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
      signer,
      ...whirlpoolUsdcSolAccounts(pool, owners),
      wsolOwnerAccount: vaultWsolAta,
    } as never)
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
  const program = createProgram(wallet, connection, network);
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
  const program = createProgram(wallet, connection, network);
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
  const program = createProgram(wallet, connection, network);
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
  network: Network,
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
      redeemState: deriveRedeemStatePda(user, ctx.vaultId, network),
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
  const program = createProgram(wallet, connection, network);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const ix = await buildSwapAssetToSolIx(connection, program, ctx, assetIndex, user, minWsolOut, network);
  const sig = await sendV0(connection, wallet, [ix]);
  return { tx: sig, link: solscanLink(sig, network) };
}

/** Outflow leg-2 builder (ViaSol): accumulated wSOL for a slot → USDC. */
async function buildSwapSolToUsdcIx(
  connection: Connection,
  program: ReturnType<typeof createProgram>,
  ctx: VaultChainCtx,
  assetIndex: number,
  wsolAmount: BN,
  minUsdcOut: BN,
  user: PublicKey,
  network: Network,
): Promise<TransactionInstruction> {
  const vaultWsolAta = vaultAssetAta(ctx.vaultAuthority, WSOL_MINT);
  const pool = await fetchPoolCtx(connection, requireUsdcSolPool(ctx));
  const owners = ownerAccountsFor(pool, vaultWsolAta, ctx.baseMint, ctx.usdcVault);
  const aToB = pool.info.tokenMintA.equals(WSOL_MINT);

  return (program.methods as any)
    .swapSolToUsdc(new BN(ctx.vaultId), assetIndex, wsolAmount, minUsdcOut, aToB)
    .accounts({
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
      redeemState: deriveRedeemStatePda(user, ctx.vaultId, network),
      usdcVault: ctx.usdcVault,
      user,
      ...whirlpoolUsdcSolAccounts(pool, owners),
    } as never)
    .instruction();
}

/** Outflow leg 2 (ViaSol): accumulated wSOL for a slot → USDC. */
export async function swapSolToUsdc(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  assetIndex: number,
  wsolAmount: BN,
  minUsdcOut: BN,
  user: PublicKey,
  network: Network,
) {
  const program = createProgram(wallet, connection, network);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const ix = await buildSwapSolToUsdcIx(
    connection, program, ctx, assetIndex, wsolAmount, minUsdcOut, user, network,
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
  network: Network,
): Promise<TransactionInstruction> {
  const asset = assetAt(ctx, assetIndex);
  const assetAta = asset.vaultAssetAtaKey;
  const { remaining, aToB } = await buildAssetSwapRemaining(
    connection,
    ctx,
    asset,
    asset.mint,
    assetAta,
    ctx.usdcVault,
  );

  return (program.methods as any)
    .swapAssetToUsdc(new BN(ctx.vaultId), assetIndex, minUsdcOut, aToB)
    .accounts({
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
      redeemState: deriveRedeemStatePda(user, ctx.vaultId, network),
      usdcVault: ctx.usdcVault,
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
  const program = createProgram(wallet, connection, network);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const ix = await buildSwapAssetToUsdcIx(connection, program, ctx, assetIndex, user, minUsdcOut, network);
  const sig = await sendV0(connection, wallet, [ix]);
  return { tx: sig, link: solscanLink(sig, network) };
}

// ─── Bundled flows (ALT-compressed v0 transactions — Plan.md §6-9) ────────────
// Devnet has no bundle support, so the deposit legs are packed into a single
// v0 transaction using the vault's Address Lookup Table (created alongside the
// vault and stored in the Supabase `vaults.alt_address` column).

export type ProgressFn = (message: string) => void;

async function resolveVaultAlt(
  connection: Connection,
  altAddress: string | null | undefined,
): Promise<AddressLookupTableAccount | null> {
  if (!altAddress) return null;
  try {
    return await fetchAlt(connection, new PublicKey(altAddress));
  } catch {
    return null; // fall back to static keys — bigger tx, same behavior
  }
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
) {
  const program = createProgram(wallet, connection, network);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const lut = await resolveVaultAlt(connection, altAddress);

  const ixs: TransactionInstruction[] = [
    ...ensureVaultAssetAtaIxs(wallet.publicKey, ctx),
    ...(await buildDepositIxs(connection, program, ctx, wallet.publicKey, usdcAmount, minSharesOut, network)),
    ...(await buildInflowSwapIxs(connection, program, ctx, wallet.publicKey)),
  ];

  const sig = await sendV0(connection, wallet, ixs, lut);
  return { tx: sig, link: solscanLink(sig, network) };
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
) {
  const program = createProgram(wallet, connection, network);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const vault = await (program.account as any).vault.fetch(ctx.vaultPda);
  const pendingUsdc = BigInt(vault.totalPendingUsdc.toString());
  const pendingSol = BigInt(vault.totalPendingSol.toString());
  if (pendingUsdc === 0n && pendingSol === 0n) {
    throw new Error('Nothing pending to deploy — deposit first.');
  }

  const lut = await resolveVaultAlt(connection, altAddress);
  const ixs: TransactionInstruction[] = [
    ...ensureVaultAssetAtaIxs(wallet.publicKey, ctx),
    // Skip the USDC→wSOL hop when only wSOL is left pending.
    ...(await buildInflowSwapIxs(connection, program, ctx, wallet.publicKey, {
      includeUsdcToSol: pendingUsdc > 0n,
    })),
  ];

  const sig = await sendV0(connection, wallet, ixs, lut);
  return { tx: sig, link: solscanLink(sig, network) };
}

interface RawRedeemState {
  redeemableShares: BN;
  unlockTime: BN;
  pendingUsdc: BN;
  numAssets: number;
  assetAmountIn: BN[];
  assetSwapped: boolean[];
}

async function tryFetchRedeemState(
  program: ReturnType<typeof createProgram>,
  user: PublicKey,
  vaultId: number,
  network: Network,
): Promise<RawRedeemState | null> {
  try {
    return await (program.account as any).redeemState.fetch(
      deriveRedeemStatePda(user, vaultId, network),
    );
  } catch {
    return null;
  }
}

export interface RedeemClaimResult {
  /** 'requested' — shares burned, cooldown running; 'claimed' — payout sent. */
  phase: 'requested' | 'claimed';
  unlockTime?: number;
  signatures: string[];
  link: string;
}

/**
 * The single "Redeem & Claim" action (Plan.md §8-9). Everything is checked
 * on-chain — no user rows exist anywhere off-chain:
 *
 *  1. No RedeemState → verify the share balance, then `[approve, request_redeem]`.
 *  2. Cooldown still running → stop and report the unlock time.
 *  3. Unlocked → run the outflow legs (each ViaSol asset→wSOL leg is its own
 *     transaction so the received wSOL can be measured; the wSOL-native slot's
 *     amount is already known from RedeemState), then all →USDC legs in one
 *     ALT-compressed transaction, then `claim`.
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
  const program = createProgram(wallet, connection, network);
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const lut = await resolveVaultAlt(connection, altAddress);
  const user = wallet.publicKey;
  const signatures: string[] = [];

  let redeemState = await tryFetchRedeemState(program, user, vaultId, network);

  if (!redeemState || redeemState.redeemableShares.isZero()) {
    // Phase 1 — on-chain share balance check, then burn.
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

    onProgress?.('Burning shares (request_redeem)…');
    const ixs = await buildRequestRedeemIxs(program, ctx, user, shares, network);
    signatures.push(await sendV0(connection, wallet, ixs, lut));
    redeemState = await tryFetchRedeemState(program, user, vaultId, network);
    if (!redeemState) throw new Error('RedeemState not found after request_redeem.');
  }

  const unlockTime = Number(redeemState.unlockTime.toString());
  if (unlockTime * 1000 > Date.now()) {
    const last = signatures[signatures.length - 1];
    return {
      phase: 'requested',
      unlockTime,
      signatures,
      link: last ? solscanLink(last, network) : '',
    };
  }

  // Phase 2 — outflow legs. ViaSol asset→wSOL legs run one per transaction so
  // the wSOL received can be measured off-chain (swap_sol_to_usdc takes the
  // amount explicitly); all →USDC legs then share one bundle.
  const usdcLegIxs: TransactionInstruction[] = [];
  for (let i = 0; i < redeemState.numAssets; i++) {
    if (redeemState.assetSwapped[i]) continue;
    const amountIn = new BN(redeemState.assetAmountIn[i].toString());
    if (amountIn.isZero()) continue;
    const asset = assetAt(ctx, i);

    if (asset.mint.equals(WSOL_MINT)) {
      usdcLegIxs.push(
        await buildSwapSolToUsdcIx(connection, program, ctx, i, amountIn, new BN(0), user, network),
      );
    } else if (asset.route === 'ViaSol') {
      onProgress?.(`Swapping asset ${i + 1}/${redeemState.numAssets} → wSOL…`);
      const before = await vaultWsolBalance(connection, ctx);
      const legIx = await buildSwapAssetToSolIx(connection, program, ctx, i, user, new BN(0), network);
      signatures.push(await sendV0(connection, wallet, [legIx], lut));
      const received = (await vaultWsolBalance(connection, ctx)) - before;
      if (received > 0n) {
        usdcLegIxs.push(
          await buildSwapSolToUsdcIx(
            connection, program, ctx, i, new BN(received.toString()), new BN(0), user, network,
          ),
        );
      }
    } else {
      usdcLegIxs.push(
        await buildSwapAssetToUsdcIx(connection, program, ctx, i, user, new BN(0), network),
      );
    }
  }

  if (usdcLegIxs.length > 0) {
    onProgress?.('Converting to base token…');
    signatures.push(await sendV0(connection, wallet, usdcLegIxs, lut));
  }

  // Phase 3 — claim (program re-checks unlock_time and pending_usdc > 0).
  onProgress?.('Claiming payout…');
  const claimIxs = await buildClaimIxs(connection, program, ctx, user, network);
  signatures.push(await sendV0(connection, wallet, claimIxs, lut));

  return {
    phase: 'claimed',
    signatures,
    link: solscanLink(signatures[signatures.length - 1], network),
  };
}

// ─── View functions ───────────────────────────────────────────────────────────

export interface GlobalStateView {
  isEmergency: boolean;
  totalVaults: string;
  treasuryAddr: string;
  twapKeeper: string;
  totalAssets: string;
}

export async function getGlobalState(
  connection: Connection,
  network: Network = 'mainnet',
): Promise<GlobalStateView> {
  const program = createProgram(createDummyWallet(), connection, network);
  const pda = deriveGlobalStatePda(network);
  const gs = await (program.account as any).globalState.fetch(pda);
  return {
    isEmergency: gs.isEmergency,
    totalVaults: gs.totalVaults.toString(),
    treasuryAddr: (gs.treasuryAddr as PublicKey).toBase58(),
    twapKeeper: (gs.twapKeeper as PublicKey).toBase58(),
    totalAssets: gs.totalAssets.toString(),
  };
}

export interface VaultStateView {
  address: string;
  vaultId: string;
  baseMint: string;
  feeRecipient: string;
  totalShares: string;
  totalUsdcValue: string;
  totalPendingUsdc: string;
  totalPendingSol: string;
  depositFeeBps: number;
  redeemFeeBps: number;
  athSharePrice: string;
  numAssets: number;
  paused: boolean;
  adminLocked: boolean;
  usdcSolPool: string | null;
}

export async function getVaultState(
  connection: Connection,
  vaultId: number = DEFAULT_VAULT_ID,
  network: Network = 'mainnet',
): Promise<VaultStateView> {
  const ctx = await fetchVaultCtx(connection, vaultId, network);
  const program = createProgram(createDummyWallet(), connection, network);
  const vault = await (program.account as any).vault.fetch(ctx.vaultPda);
  const pausedRaw = vault.paused as number | boolean;
  const adminLockedRaw = vault.adminLocked as number | boolean;

  return {
    address: ctx.vaultPda.toBase58(),
    vaultId: vault.vaultId.toString(),
    baseMint: ctx.baseMint.toBase58(),
    feeRecipient: vault.feeRecipient.toBase58(),
    totalShares: vault.totalShares.toString(),
    totalUsdcValue: vault.totalUsdcValue.toString(),
    totalPendingUsdc: vault.totalPendingUsdc.toString(),
    totalPendingSol: vault.totalPendingSol.toString(),
    depositFeeBps: vault.depositFeeBps,
    redeemFeeBps: vault.redeemFeeBps,
    athSharePrice: vault.athSharePrice.toString(),
    numAssets: vault.numAssets,
    paused: typeof pausedRaw === 'boolean' ? pausedRaw : pausedRaw !== 0,
    adminLocked: typeof adminLockedRaw === 'boolean' ? adminLockedRaw : adminLockedRaw !== 0,
    usdcSolPool: ctx.usdcSolPool?.toBase58() ?? null,
  };
}

export interface NavView {
  totalNav: string;
  sharePrice: string;
  totalShares: string;
}

export async function getTotalNavView(
  connection: Connection,
  vaultId: number = DEFAULT_VAULT_ID,
  network: Network = 'mainnet',
): Promise<NavView> {
  const program = createProgram(createDummyWallet(), connection, network);
  const ctx = await fetchVaultCtx(connection, vaultId, network);

  const result = await (program.methods as any)
    .getTotalNavView(new BN(vaultId))
    .accounts({ vault: ctx.vaultPda } as never)
    .remainingAccounts(await navRemainingAccounts(connection, ctx))
    .view();

  return {
    totalNav: result.totalNav.toString(),
    sharePrice: result.sharePrice.toString(),
    totalShares: result.totalShares.toString(),
  };
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
): Promise<PreviewDepositResult> {
  const program = createProgram(createDummyWallet(), connection, network);
  const ctx = await fetchVaultCtx(connection, vaultId, network);

  const result = await (program.methods as any)
    .previewDeposit(new BN(vaultId), usdcAmount)
    .accounts({ globalState: deriveGlobalStatePda(network), vault: ctx.vaultPda } as never)
    .remainingAccounts(await navRemainingAccounts(connection, ctx))
    .view();

  return {
    sharesToMint: result.sharesToMint.toString(),
    totalNav: result.totalNav.toString(),
    sharePrice: result.sharePrice.toString(),
    totalShares: result.totalShares.toString(),
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
): Promise<PreviewRedeemResult> {
  const program = createProgram(createDummyWallet(), connection, network);
  const ctx = await fetchVaultCtx(connection, vaultId, network);

  const result = await (program.methods as any)
    .previewRedeem(new BN(vaultId), shares)
    .accounts({ globalState: deriveGlobalStatePda(network), vault: ctx.vaultPda } as never)
    .remainingAccounts(await navRemainingAccounts(connection, ctx))
    .view();

  return {
    numAssets: result.numAssets,
    assetAmounts: (result.assetAmounts as BN[]).map((a) => a.toString()),
    estimatedUsdcValue: result.estimatedUsdcValue.toString(),
    totalShares: result.totalShares.toString(),
  };
}

export interface UserPosition {
  user: string;
  shareBalance: string;
  userInfo?: {
    totalUsdcDeposited: string;
    lastUsdcDeposited: string;
    lastSharesMinted: string;
    lastDepositTs: string;
  };
  redeemState?: {
    redeemableShares: string;
    unlockTime: string;
    pendingUsdc: string;
    numAssets: number;
    assetAmountIn: string[];
    assetSwapped: boolean[];
  };
}

export async function getUserPosition(
  connection: Connection,
  vaultId: number = DEFAULT_VAULT_ID,
  user: PublicKey,
  network: Network = 'mainnet',
): Promise<UserPosition> {
  const program = createProgram(createDummyWallet(), connection, network);
  const { vaultPda, sharesMint } = deriveVaultPdas(vaultId, network);
  const userShareAta = getAssociatedTokenAddressSync(sharesMint, user, false, TOKEN_2022_PROGRAM_ID);

  let shareBalance = '0';
  try {
    const bal = await connection.getTokenAccountBalance(userShareAta);
    shareBalance = bal.value.amount;
  } catch {
    // ata may not exist
  }

  const userInfoPda = deriveUserInfoPda(vaultPda, user, network);
  let userInfoData = null;
  try {
    userInfoData = await (program.account as any).userInfo.fetch(userInfoPda);
  } catch {
    // not created yet
  }

  const redeemPda = deriveRedeemStatePda(user, vaultId, network);
  let redeemData = null;
  try {
    redeemData = await (program.account as any).redeemState.fetch(redeemPda);
  } catch {
    // no pending redeem
  }

  return {
    user: user.toBase58(),
    shareBalance,
    userInfo: userInfoData
      ? {
          totalUsdcDeposited: userInfoData.totalUsdcDeposited.toString(),
          lastUsdcDeposited: userInfoData.lastUsdcDeposited.toString(),
          lastSharesMinted: userInfoData.lastSharesMinted.toString(),
          lastDepositTs: userInfoData.lastDepositTs.toString(),
        }
      : undefined,
    redeemState: redeemData
      ? {
          redeemableShares: redeemData.redeemableShares.toString(),
          unlockTime: redeemData.unlockTime.toString(),
          pendingUsdc: redeemData.pendingUsdc.toString(),
          numAssets: redeemData.numAssets,
          assetAmountIn: (redeemData.assetAmountIn as BN[]).map((a) => a.toString()),
          assetSwapped: redeemData.assetSwapped,
        }
      : undefined,
  };
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
 * Turn a preview `.view()` failure into a legible message. When a vault's
 * asset ATAs or Pyth feed accounts don't exist yet on-chain, the simulation
 * fails with `AccountNotFound` and an empty error message — surface that
 * instead of a blank string.
 */
export function describePreviewError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const blob = `${raw} ${JSON.stringify((err as { simulationResponse?: unknown })?.simulationResponse ?? '')}`;
  if (!raw.trim() || blob.includes('AccountNotFound')) {
    return "Preview unavailable — the vault's asset accounts or price feeds aren't initialized on-chain yet.";
  }
  return raw;
}

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
