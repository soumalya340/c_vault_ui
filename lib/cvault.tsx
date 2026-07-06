'use client';

import { Buffer as NodeBuffer } from 'buffer';
if (typeof globalThis !== 'undefined' && !('Buffer' in globalThis)) {
  (globalThis as { Buffer?: typeof NodeBuffer }).Buffer = NodeBuffer;
}

import {
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
} from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import type { AnchorWallet } from '@solana/wallet-adapter-react';

import { solscanLink, type Network } from './solscanLink';
import { createProgram, createDummyWallet } from './program';
import {
  deriveGlobalStatePda,
  deriveVaultPdas,
  deriveUserInfoPda,
  deriveRedeemStatePda,
} from './pda';
import { fetchPoolCtx, ownerAccountsFor, type PoolCtx } from './whirlpool';
import {
  C_VAULT_PROGRAM_ID,
  ADMIN_PUBKEY,
  DEFAULT_VAULT_ID,
  USDC_MINT,
  WSOL_MINT,
  WHIRLPOOL_PROGRAM_ID,
  PYTH_PUSH_ORACLE_PROGRAM_ID,
} from './constants';

export {
  C_VAULT_PROGRAM_ID,
  ADMIN_PUBKEY,
  DEFAULT_VAULT_ID,
  USDC_MINT,
  WSOL_MINT,
};
export {
  deriveGlobalStatePda,
  deriveVaultPdas,
  deriveUserInfoPda,
  deriveRedeemStatePda,
};
export type { Network };

// ─── On-chain vault context ───────────────────────────────────────────────────
// Everything a vault instruction needs is read from the vault account itself
// (asset basket, base mint, pools, feed ids) — nothing is hardcoded and no
// manual price-feed input exists anywhere in the UI.

export type AssetRoute = 'ViaSol' | 'DirectUsdc';

export interface VaultChainAsset {
  mint: PublicKey;
  poolAddress: PublicKey;
  pythFeedId: number[];
  allocationBps: number;
  decimals: number;
  route: AssetRoute;
}

export interface VaultChainCtx {
  vaultId: number;
  vaultPda: PublicKey;
  vaultAuthority: PublicKey;
  sharesMint: PublicKey;
  usdcVault: PublicKey;
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

export function vaultAssetAta(vaultAuthority: PublicKey, assetMint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(assetMint, vaultAuthority, true, TOKEN_PROGRAM_ID);
}

interface RawVaultAsset {
  mint: PublicKey;
  poolAddress: PublicKey;
  pythFeedId: number[];
  allocationBps: number;
  decimals: number;
  route: { viaSol?: Record<string, never>; directUsdc?: Record<string, never> };
}

export async function fetchVaultCtx(
  connection: Connection,
  vaultId: number,
): Promise<VaultChainCtx> {
  const program = createProgram(createDummyWallet(), connection);
  const { vaultPda, vaultAuthority, sharesMint } = deriveVaultPdas(vaultId);
  const vault = await (program.account as any).vault.fetch(vaultPda);

  const baseMint = vault.baseMint as PublicKey;
  const { usdcVault } = deriveVaultPdas(vaultId, baseMint);
  const numAssets = vault.numAssets as number;
  const assets: VaultChainAsset[] = (vault.assets as RawVaultAsset[])
    .slice(0, numAssets)
    .map((a) => ({
      mint: a.mint,
      poolAddress: a.poolAddress,
      pythFeedId: Array.from(a.pythFeedId),
      allocationBps: a.allocationBps,
      decimals: a.decimals,
      route: a.route.viaSol ? 'ViaSol' : 'DirectUsdc',
    }));

  return {
    vaultId,
    vaultPda,
    vaultAuthority,
    sharesMint,
    usdcVault,
    baseMint,
    usdcSolPool: (vault.usdcSolPool as PublicKey | null) ?? null,
    feeRecipient: vault.feeRecipient as PublicKey,
    numAssets,
    assets,
  };
}

type AccountMeta = { pubkey: PublicKey; isSigner: boolean; isWritable: boolean };

function readonlyMetas(keys: PublicKey[]): AccountMeta[] {
  return keys.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }));
}

/** `[asset_ata_0..N, price_feed_0..N]` — deposit / NAV / preview instructions. */
function navRemainingAccounts(ctx: VaultChainCtx): AccountMeta[] {
  const atas = ctx.assets.map((a) => vaultAssetAta(ctx.vaultAuthority, a.mint));
  const feeds = ctx.assets.map((a) => pythFeedAccount(a.pythFeedId));
  return readonlyMetas([...atas, ...feeds]);
}

/** `[asset_ata_0..N]` — request_redeem only reads the vault asset balances. */
function assetAtaRemainingAccounts(ctx: VaultChainCtx): AccountMeta[] {
  return readonlyMetas(ctx.assets.map((a) => vaultAssetAta(ctx.vaultAuthority, a.mint)));
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

function globalAdminAccounts(admin: PublicKey) {
  return { globalState: deriveGlobalStatePda(), admin } as Record<string, PublicKey>;
}

export async function initGlobalState(
  connection: Connection,
  wallet: AnchorWallet,
  platformFeeBps: number,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await (program.methods as any)
    .initGlobalState(new BN(platformFeeBps))
    .accounts({ authority: wallet.publicKey } as never)
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}

export async function addEligibleBaseMint(
  connection: Connection,
  wallet: AnchorWallet,
  mint: PublicKey,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await (program.methods as any)
    .addEligibleBaseMint(mint)
    .accounts(globalAdminAccounts(wallet.publicKey) as never)
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}

export async function removeEligibleBaseMint(
  connection: Connection,
  wallet: AnchorWallet,
  mint: PublicKey,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await (program.methods as any)
    .removeEligibleBaseMint(mint)
    .accounts(globalAdminAccounts(wallet.publicKey) as never)
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}

export async function updatePlatformFeeBps(
  connection: Connection,
  wallet: AnchorWallet,
  platformFeeBps: number,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await (program.methods as any)
    .updatePlatformFeeBps(new BN(platformFeeBps))
    .accounts(globalAdminAccounts(wallet.publicKey) as never)
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}

export async function updateTreasuryAddr(
  connection: Connection,
  wallet: AnchorWallet,
  treasury: PublicKey,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await (program.methods as any)
    .updateTreasuryAddr(treasury)
    .accounts(globalAdminAccounts(wallet.publicKey) as never)
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}

export async function setEmergency(
  connection: Connection,
  wallet: AnchorWallet,
  isEmergency: boolean,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await (program.methods as any)
    .setEmergency(isEmergency)
    .accounts(globalAdminAccounts(wallet.publicKey) as never)
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}

export async function setDepositDisable(
  connection: Connection,
  wallet: AnchorWallet,
  disabled: boolean,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await (program.methods as any)
    .setDepositDisable(disabled)
    .accounts(globalAdminAccounts(wallet.publicKey) as never)
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}

// ─── Vault Ops — vault_ops.rs (vault-manager-scoped) ─────────────────────────

function vaultManagerAccounts(vaultId: number, vaultManager: PublicKey) {
  const { vaultPda } = deriveVaultPdas(vaultId);
  return { vault: vaultPda, vaultManager } as Record<string, PublicKey>;
}

export async function resume(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await (program.methods as any)
    .resume(new BN(vaultId))
    .accounts(vaultManagerAccounts(vaultId, wallet.publicKey) as never)
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}

export async function setPaused(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  paused: boolean,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await (program.methods as any)
    .setPaused(new BN(vaultId), paused)
    .accounts(vaultManagerAccounts(vaultId, wallet.publicKey) as never)
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}

export async function setRedeemCooldown(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  cooldownSecs: number,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await (program.methods as any)
    .setRedeemCooldown(new BN(vaultId), new BN(cooldownSecs))
    .accounts(vaultManagerAccounts(vaultId, wallet.publicKey) as never)
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}

export async function setFeeRecipient(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  feeRecipient: PublicKey,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await (program.methods as any)
    .setFeeRecipient(new BN(vaultId), feeRecipient)
    .accounts(vaultManagerAccounts(vaultId, wallet.publicKey) as never)
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}

// ─── Create ETF (create_etf.rs — vault + Token-2022 metadata in one tx) ──────

export interface AssetParam {
  mint: PublicKey;
  poolAddress: PublicKey;
  pythFeedId: number[];
  allocationBps: number;
  decimals: number;
  route: { directUsdc: Record<string, never> } | { viaSol: Record<string, never> };
}

export interface CreateEtfParams {
  feeRecipient: PublicKey | null;
  performanceFeeBps: number;
  usdcSolPool: PublicKey | null;
  assets: AssetParam[];
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
 */
export async function createEtf(
  connection: Connection,
  wallet: AnchorWallet,
  baseMint: PublicKey,
  params: CreateEtfParams,
  name: string,
  symbol: string,
  uri: string,
  network: Network,
): Promise<CreatedVaultInfo> {
  const program = createProgram(wallet, connection);

  // The program assigns vault_id = global_state.total_vaults at execution.
  const gs = await (program.account as any).globalState.fetch(deriveGlobalStatePda());
  const vaultId = (gs.totalVaults as BN).toNumber();

  const sig = await (program.methods as any)
    .createEtf(params, name, symbol, uri)
    .accounts({
      authority: wallet.publicKey,
      usdcMint: baseMint,
      sharesTokenProgram: TOKEN_2022_PROGRAM_ID,
    } as never)
    .rpc();

  const pdas = deriveVaultPdas(vaultId, baseMint);
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
 * Instruction A of the deposit flow. User ATAs (base + Token-2022 share) are
 * created idempotently in the same transaction, so no separate "create token
 * accounts" step exists.
 */
export async function deposit(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  usdcAmount: BN,
  minSharesOut: BN,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const ctx = await fetchVaultCtx(connection, vaultId);
  const globalState = deriveGlobalStatePda();
  const userBase = baseAta(wallet.publicKey, ctx.baseMint);
  const userShares = getAssociatedTokenAddressSync(
    ctx.sharesMint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID,
  );
  const userInfo = deriveUserInfoPda(ctx.vaultPda, wallet.publicKey);
  const treasury = await fetchTreasury(connection);

  const ensureAtaIxs: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey, userBase, wallet.publicKey, ctx.baseMint, TOKEN_PROGRAM_ID,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey, userShares, wallet.publicKey, ctx.sharesMint, TOKEN_2022_PROGRAM_ID,
    ),
  ];

  const sig = await (program.methods as any)
    .deposit(new BN(vaultId), usdcAmount, minSharesOut)
    .accounts({
      globalState,
      vault: ctx.vaultPda,
      baseMint: ctx.baseMint,
      vaultAuthority: ctx.vaultAuthority,
      usdcVault: ctx.usdcVault,
      shareMint: ctx.sharesMint,
      userUsdcAccount: userBase,
      userShareAccount: userShares,
      user: wallet.publicKey,
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
    .preInstructions(ensureAtaIxs)
    .remainingAccounts(navRemainingAccounts(ctx))
    .rpc();

  return { tx: sig, link: solscanLink(sig, network) };
}

export async function requestRedeem(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  shares: BN,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const ctx = await fetchVaultCtx(connection, vaultId);
  const globalState = deriveGlobalStatePda();
  const userShares = getAssociatedTokenAddressSync(
    ctx.sharesMint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID,
  );
  const redeemState = deriveRedeemStatePda(wallet.publicKey, vaultId);

  const sig = await (program.methods as any)
    .requestRedeem(new BN(vaultId), shares)
    .accounts({
      globalState,
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
      sharesMint: ctx.sharesMint,
      userShareAccount: userShares,
      redeemState,
      user: wallet.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as never)
    .remainingAccounts(assetAtaRemainingAccounts(ctx))
    .rpc();

  return { tx: sig, link: solscanLink(sig, network) };
}

export async function claim(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const ctx = await fetchVaultCtx(connection, vaultId);
  const globalState = deriveGlobalStatePda();
  const redeemState = deriveRedeemStatePda(wallet.publicKey, vaultId);
  const userBase = baseAta(wallet.publicKey, ctx.baseMint);
  const treasury = await fetchTreasury(connection);

  const sig = await (program.methods as any)
    .claim(new BN(vaultId))
    .accounts({
      globalState,
      vault: ctx.vaultPda,
      baseMint: ctx.baseMint,
      vaultAuthority: ctx.vaultAuthority,
      redeemState,
      usdcVault: ctx.usdcVault,
      userUsdcAccount: userBase,
      user: wallet.publicKey,
      treasury,
      treasuryUsdcAccount: baseAta(treasury, ctx.baseMint),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    } as never)
    .rpc();

  return { tx: sig, link: solscanLink(sig, network) };
}

// ─── Swap legs (accounts derived from the vault's asset basket) ──────────────

function whirlpoolCommonAccounts(pool: PoolCtx, owners: { ownerA: PublicKey; ownerB: PublicKey }) {
  return {
    tokenProgram: TOKEN_PROGRAM_ID,
    whirlpoolProgram: WHIRLPOOL_PROGRAM_ID,
    whirlpool: pool.address,
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

/** Inflow: pending USDC (ViaSol slice) → wSOL. */
export async function swapUsdcToSol(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  minWsolOut: BN,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const ctx = await fetchVaultCtx(connection, vaultId);
  const vaultWsolAta = vaultAssetAta(ctx.vaultAuthority, WSOL_MINT);
  const pool = await fetchPoolCtx(connection, requireUsdcSolPool(ctx));
  const owners = ownerAccountsFor(pool, vaultWsolAta, ctx.baseMint, ctx.usdcVault);
  const aToB = pool.info.tokenMintA.equals(ctx.baseMint);

  const sig = await (program.methods as any)
    .swapUsdcToSol(new BN(vaultId), minWsolOut, aToB)
    .accounts({
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
      signer: wallet.publicKey,
      ...whirlpoolCommonAccounts(pool, owners),
      wsolOwnerAccount: vaultWsolAta,
    } as never)
    .rpc();

  return { tx: sig, link: solscanLink(sig, network) };
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
  const ctx = await fetchVaultCtx(connection, vaultId);
  const asset = assetAt(ctx, assetIndex);
  const assetAta = vaultAssetAta(ctx.vaultAuthority, asset.mint);
  const pool = await fetchPoolCtx(connection, asset.poolAddress);
  const owners = pool.info.tokenMintA.equals(ctx.baseMint)
    ? { ownerA: ctx.usdcVault, ownerB: assetAta }
    : { ownerA: assetAta, ownerB: ctx.usdcVault };
  const aToB = pool.info.tokenMintA.equals(ctx.baseMint);

  const sig = await (program.methods as any)
    .swapUsdcToAsset(new BN(vaultId), assetIndex, minAssetOut, aToB)
    .accounts({
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
      signer: wallet.publicKey,
      ...whirlpoolCommonAccounts(pool, owners),
    } as never)
    .rpc();

  return { tx: sig, link: solscanLink(sig, network) };
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
  const ctx = await fetchVaultCtx(connection, vaultId);
  const asset = assetAt(ctx, assetIndex);
  const vaultWsolAta = vaultAssetAta(ctx.vaultAuthority, WSOL_MINT);
  const assetAta = vaultAssetAta(ctx.vaultAuthority, asset.mint);
  const pool = await fetchPoolCtx(connection, asset.poolAddress);
  const owners = ownerAccountsFor(pool, vaultWsolAta, asset.mint, assetAta);
  const aToB = pool.info.tokenMintA.equals(WSOL_MINT);

  const sig = await (program.methods as any)
    .swapSolToAsset(new BN(vaultId), assetIndex, minAssetOut, aToB)
    .accounts({
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
      signer: wallet.publicKey,
      ...whirlpoolCommonAccounts(pool, owners),
    } as never)
    .rpc();

  return { tx: sig, link: solscanLink(sig, network) };
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
  const ctx = await fetchVaultCtx(connection, vaultId);
  const asset = assetAt(ctx, assetIndex);
  const vaultWsolAta = vaultAssetAta(ctx.vaultAuthority, WSOL_MINT);
  const assetAta = vaultAssetAta(ctx.vaultAuthority, asset.mint);
  const redeemState = deriveRedeemStatePda(user, vaultId);
  const pool = await fetchPoolCtx(connection, asset.poolAddress);
  const owners = ownerAccountsFor(pool, vaultWsolAta, asset.mint, assetAta);
  const aToB = pool.info.tokenMintA.equals(asset.mint);

  const sig = await (program.methods as any)
    .swapAssetToSol(new BN(vaultId), assetIndex, minWsolOut, aToB)
    .accounts({
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
      redeemState,
      user,
      ...whirlpoolCommonAccounts(pool, owners),
    } as never)
    .rpc();

  return { tx: sig, link: solscanLink(sig, network) };
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
  const program = createProgram(wallet, connection);
  const ctx = await fetchVaultCtx(connection, vaultId);
  const vaultWsolAta = vaultAssetAta(ctx.vaultAuthority, WSOL_MINT);
  const redeemState = deriveRedeemStatePda(user, vaultId);
  const pool = await fetchPoolCtx(connection, requireUsdcSolPool(ctx));
  const owners = ownerAccountsFor(pool, vaultWsolAta, ctx.baseMint, ctx.usdcVault);
  const aToB = pool.info.tokenMintA.equals(WSOL_MINT);

  const sig = await (program.methods as any)
    .swapSolToUsdc(new BN(vaultId), assetIndex, wsolAmount, minUsdcOut, aToB)
    .accounts({
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
      redeemState,
      usdcVault: ctx.usdcVault,
      user,
      ...whirlpoolCommonAccounts(pool, owners),
    } as never)
    .rpc();

  return { tx: sig, link: solscanLink(sig, network) };
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
  const ctx = await fetchVaultCtx(connection, vaultId);
  const asset = assetAt(ctx, assetIndex);
  const assetAta = vaultAssetAta(ctx.vaultAuthority, asset.mint);
  const redeemState = deriveRedeemStatePda(user, vaultId);
  const pool = await fetchPoolCtx(connection, asset.poolAddress);
  const owners = pool.info.tokenMintA.equals(asset.mint)
    ? { ownerA: assetAta, ownerB: ctx.usdcVault }
    : { ownerA: ctx.usdcVault, ownerB: assetAta };
  const aToB = pool.info.tokenMintA.equals(asset.mint);

  const sig = await (program.methods as any)
    .swapAssetToUsdc(new BN(vaultId), assetIndex, minUsdcOut, aToB)
    .accounts({
      vault: ctx.vaultPda,
      vaultAuthority: ctx.vaultAuthority,
      redeemState,
      usdcVault: ctx.usdcVault,
      user,
      ...whirlpoolCommonAccounts(pool, owners),
    } as never)
    .rpc();

  return { tx: sig, link: solscanLink(sig, network) };
}

// ─── View functions ───────────────────────────────────────────────────────────

export interface GlobalStateView {
  isEmergency: boolean;
  depositDisable: boolean;
  totalVaults: string;
  treasuryAddr: string;
  platformFeeBps: string;
  numEligibleBaseMints: number;
  eligibleBaseMints: string[];
}

export async function getGlobalState(connection: Connection): Promise<GlobalStateView> {
  const program = createProgram(createDummyWallet(), connection);
  const pda = deriveGlobalStatePda();
  const gs = await (program.account as any).globalState.fetch(pda);
  const eligibleBaseMints = (gs.eligibleBaseMints as PublicKey[])
    .slice(0, gs.numEligibleBaseMints)
    .map((m) => m.toBase58());
  return {
    isEmergency: gs.isEmergency,
    depositDisable: gs.depositDisable,
    totalVaults: gs.totalVaults.toString(),
    treasuryAddr: (gs.treasuryAddr as PublicKey).toBase58(),
    platformFeeBps: gs.platformFeeBps.toString(),
    numEligibleBaseMints: gs.numEligibleBaseMints,
    eligibleBaseMints,
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
  performanceFeeBps: number;
  redeemCooldownSecs: string;
  athSharePrice: string;
  numAssets: number;
  paused: boolean;
}

export async function getVaultState(
  connection: Connection,
  vaultId: number = DEFAULT_VAULT_ID,
): Promise<VaultStateView> {
  const program = createProgram(createDummyWallet(), connection);
  const { vaultPda } = deriveVaultPdas(vaultId);
  const vault = await (program.account as any).vault.fetch(vaultPda);

  return {
    address: vaultPda.toBase58(),
    vaultId: vault.vaultId.toString(),
    baseMint: (vault.baseMint as PublicKey).toBase58(),
    feeRecipient: vault.feeRecipient.toBase58(),
    totalShares: vault.totalShares.toString(),
    totalUsdcValue: vault.totalUsdcValue.toString(),
    totalPendingUsdc: vault.totalPendingUsdc.toString(),
    totalPendingSol: vault.totalPendingSol.toString(),
    performanceFeeBps: vault.performanceFeeBps,
    redeemCooldownSecs: vault.redeemCooldownSecs.toString(),
    athSharePrice: vault.athSharePrice.toString(),
    numAssets: vault.numAssets,
    paused: vault.paused,
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
): Promise<NavView> {
  const program = createProgram(createDummyWallet(), connection);
  const ctx = await fetchVaultCtx(connection, vaultId);

  const result = await (program.methods as any)
    .getTotalNavView(new BN(vaultId))
    .accounts({ vault: ctx.vaultPda } as never)
    .remainingAccounts(navRemainingAccounts(ctx))
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
): Promise<PreviewDepositResult> {
  const program = createProgram(createDummyWallet(), connection);
  const ctx = await fetchVaultCtx(connection, vaultId);

  const result = await (program.methods as any)
    .previewDeposit(new BN(vaultId), usdcAmount)
    .accounts({ globalState: deriveGlobalStatePda(), vault: ctx.vaultPda } as never)
    .remainingAccounts(navRemainingAccounts(ctx))
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
): Promise<PreviewRedeemResult> {
  const program = createProgram(createDummyWallet(), connection);
  const ctx = await fetchVaultCtx(connection, vaultId);

  const result = await (program.methods as any)
    .previewRedeem(new BN(vaultId), shares)
    .accounts({ globalState: deriveGlobalStatePda(), vault: ctx.vaultPda } as never)
    .remainingAccounts(navRemainingAccounts(ctx))
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
): Promise<UserPosition> {
  const program = createProgram(createDummyWallet(), connection);
  const { vaultPda, sharesMint } = deriveVaultPdas(vaultId);
  const userShareAta = getAssociatedTokenAddressSync(sharesMint, user, false, TOKEN_2022_PROGRAM_ID);

  let shareBalance = '0';
  try {
    const bal = await connection.getTokenAccountBalance(userShareAta);
    shareBalance = bal.value.amount;
  } catch {
    // ata may not exist
  }

  const userInfoPda = deriveUserInfoPda(vaultPda, user);
  let userInfoData = null;
  try {
    userInfoData = await (program.account as any).userInfo.fetch(userInfoPda);
  } catch {
    // not created yet
  }

  const redeemPda = deriveRedeemStatePda(user, vaultId);
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
