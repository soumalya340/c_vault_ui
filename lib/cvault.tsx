'use client';

import { Buffer as NodeBuffer } from 'buffer';
if (typeof globalThis !== 'undefined' && !('Buffer' in globalThis)) {
  (globalThis as { Buffer?: typeof NodeBuffer }).Buffer = NodeBuffer;
}

import {
  Connection,
  PublicKey,
  SystemProgram,
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
import { fetchPoolCtx, ownerAccountsFor } from './whirlpool';
import {
  C_VAULT_PROGRAM_ID,
  ADMIN_PUBKEY,
  DEFAULT_VAULT_ID,
  USDC_MINT,
  WSOL_MINT,
  WBTC_MINT,
  WETH_MINT,
  WSOL_USDC_POOL,
  WSOL_WBTC_POOL,
  WSOL_WETH_POOL,
  WHIRLPOOL_PROGRAM_ID,
} from './constants';

export {
  C_VAULT_PROGRAM_ID,
  ADMIN_PUBKEY,
  DEFAULT_VAULT_ID,
  USDC_MINT,
  WSOL_MINT,
  WBTC_MINT,
  WETH_MINT,
  WSOL_USDC_POOL,
  WSOL_WBTC_POOL,
  WSOL_WETH_POOL,
};
export {
  deriveGlobalStatePda,
  deriveVaultPdas,
  deriveUserInfoPda,
  deriveRedeemStatePda,
};
export type { Network };

export interface PriceFeeds {
  sol: PublicKey;
  btc: PublicKey;
  eth: PublicKey;
}

export function deriveVaultAssetAta(vaultId: number, assetMint: PublicKey): PublicKey {
  const { vaultAuthority } = deriveVaultPdas(vaultId);
  return getAssociatedTokenAddressSync(assetMint, vaultAuthority, true, TOKEN_PROGRAM_ID);
}

function navRemainingAccounts(
  vaultId: number,
  feeds: PriceFeeds,
): { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] {
  const wsolAta = deriveVaultAssetAta(vaultId, WSOL_MINT);
  const wbtcAta = deriveVaultAssetAta(vaultId, WBTC_MINT);
  const wethAta = deriveVaultAssetAta(vaultId, WETH_MINT);
  return [wsolAta, wbtcAta, wethAta, feeds.sol, feeds.btc, feeds.eth].map((pubkey) => ({
    pubkey,
    isSigner: false,
    isWritable: false,
  }));
}

function vaultManagerAccounts(vaultId: number, vaultManager: PublicKey) {
  const { vaultPda } = deriveVaultPdas(vaultId);
  return { vault: vaultPda, vaultManager } as Record<string, PublicKey>;
}

function usdcAta(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(USDC_MINT, owner, false, TOKEN_PROGRAM_ID);
}

async function fetchTreasuryAndFeeRecipient(
  connection: Connection,
  vaultId: number,
): Promise<{ treasury: PublicKey; feeRecipient: PublicKey }> {
  const program = createProgram(createDummyWallet(), connection);
  const gs = await (program.account as any).globalState.fetch(deriveGlobalStatePda());
  const vault = await (program.account as any).vault.fetch(deriveVaultPdas(vaultId).vaultPda);
  return {
    treasury: gs.treasuryAddr as PublicKey,
    feeRecipient: vault.feeRecipient as PublicKey,
  };
}

// ─── Admin instructions ───────────────────────────────────────────────────────

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
  const sig = await ((program.methods as any) as any)
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

export async function createEtf(
  connection: Connection,
  wallet: AnchorWallet,
  params: CreateEtfParams,
  name: string,
  symbol: string,
  uri: string,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await ((program.methods as any) as any)
    .createEtf(params, name, symbol, uri)
    .accounts({
      authority: wallet.publicKey,
      usdcMint: USDC_MINT,
    } as never)
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

// ─── Core: deposit / request_redeem / claim ───────────────────────────────────

export async function deposit(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  usdcAmount: BN,
  minSharesOut: BN,
  feeds: PriceFeeds,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const globalState = deriveGlobalStatePda();
  const { vaultPda, vaultAuthority, sharesMint, usdcVault } = deriveVaultPdas(vaultId);
  const userUsdc = usdcAta(wallet.publicKey);
  const userShares = getAssociatedTokenAddressSync(sharesMint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const userInfo = deriveUserInfoPda(vaultPda, wallet.publicKey);
  const { treasury, feeRecipient } = await fetchTreasuryAndFeeRecipient(connection, vaultId);

  const sig = await (program.methods as any)
    .deposit(new BN(vaultId), usdcAmount, minSharesOut)
    .accounts({
      globalState,
      vault: vaultPda,
      baseMint: USDC_MINT,
      vaultAuthority,
      usdcVault,
      shareMint: sharesMint,
      userUsdcAccount: userUsdc,
      userShareAccount: userShares,
      user: wallet.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      baseTokenProgram: TOKEN_PROGRAM_ID,
      userInfo,
      treasury,
      feeRecipient,
      treasuryUsdcAccount: usdcAta(treasury),
      feeRecipientUsdcAccount: usdcAta(feeRecipient),
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    } as never)
    .remainingAccounts(navRemainingAccounts(vaultId, feeds))
    .rpc();

  return { tx: sig, link: solscanLink(sig, network) };
}

export async function requestRedeem(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  shares: BN,
  feeds: PriceFeeds,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const globalState = deriveGlobalStatePda();
  const { vaultPda, vaultAuthority, sharesMint } = deriveVaultPdas(vaultId);
  const userShares = getAssociatedTokenAddressSync(sharesMint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const redeemState = deriveRedeemStatePda(wallet.publicKey, vaultId);
  const remaining = navRemainingAccounts(vaultId, feeds).slice(0, 3);

  const sig = await (program.methods as any)
    .requestRedeem(new BN(vaultId), shares)
    .accounts({
      globalState,
      vault: vaultPda,
      vaultAuthority,
      sharesMint,
      userShareAccount: userShares,
      redeemState,
      user: wallet.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as never)
    .remainingAccounts(remaining)
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
  const globalState = deriveGlobalStatePda();
  const { vaultPda, vaultAuthority, usdcVault } = deriveVaultPdas(vaultId);
  const redeemState = deriveRedeemStatePda(wallet.publicKey, vaultId);
  const userUsdc = usdcAta(wallet.publicKey);
  const { treasury } = await fetchTreasuryAndFeeRecipient(connection, vaultId);

  const sig = await (program.methods as any)
    .claim(new BN(vaultId))
    .accounts({
      globalState,
      vault: vaultPda,
      baseMint: USDC_MINT,
      vaultAuthority,
      redeemState,
      usdcVault,
      userUsdcAccount: userUsdc,
      user: wallet.publicKey,
      treasury,
      treasuryUsdcAccount: usdcAta(treasury),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    } as never)
    .rpc();

  return { tx: sig, link: solscanLink(sig, network) };
}

// ─── Inflow swaps ─────────────────────────────────────────────────────────────

export async function swapUsdcToSol(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  minWsolOut: BN,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const { vaultPda, vaultAuthority, usdcVault } = deriveVaultPdas(vaultId);
  const vaultWsolAta = deriveVaultAssetAta(vaultId, WSOL_MINT);
  const pool = await fetchPoolCtx(connection, WSOL_USDC_POOL);
  const owners = ownerAccountsFor(pool, vaultWsolAta, USDC_MINT, usdcVault);
  const aToB = pool.info.tokenMintA.equals(USDC_MINT);

  const sig = await (program.methods as any)
    .swapUsdcToSol(new BN(vaultId), minWsolOut, aToB)
    .accounts({
      vault: vaultPda,
      vaultAuthority,
      signer: wallet.publicKey,
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
      wsolOwnerAccount: vaultWsolAta,
    } as never)
    .rpc();

  return { tx: sig, link: solscanLink(sig, network) };
}

export async function swapUsdcToAsset(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  assetIndex: number,
  poolAddress: PublicKey,
  assetMint: PublicKey,
  assetAta: PublicKey,
  minAssetOut: BN,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const { vaultPda, vaultAuthority } = deriveVaultPdas(vaultId);
  const vaultWsolAta = deriveVaultAssetAta(vaultId, WSOL_MINT);
  const pool = await fetchPoolCtx(connection, poolAddress);
  const owners = ownerAccountsFor(pool, vaultWsolAta, assetMint, assetAta);
  const aToB = pool.info.tokenMintA.equals(USDC_MINT);

  const sig = await (program.methods as any)
    .swapUsdcToAsset(new BN(vaultId), assetIndex, minAssetOut, aToB)
    .accounts({
      vault: vaultPda,
      vaultAuthority,
      signer: wallet.publicKey,
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
    } as never)
    .rpc();

  return { tx: sig, link: solscanLink(sig, network) };
}

export async function swapSolToAsset(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  assetIndex: number,
  poolAddress: PublicKey,
  assetMint: PublicKey,
  assetAta: PublicKey,
  minAssetOut: BN,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const { vaultPda, vaultAuthority } = deriveVaultPdas(vaultId);
  const vaultWsolAta = deriveVaultAssetAta(vaultId, WSOL_MINT);
  const pool = await fetchPoolCtx(connection, poolAddress);
  const owners = ownerAccountsFor(pool, vaultWsolAta, assetMint, assetAta);
  const aToB = pool.info.tokenMintA.equals(WSOL_MINT);

  const sig = await (program.methods as any)
    .swapSolToAsset(new BN(vaultId), assetIndex, minAssetOut, aToB)
    .accounts({
      vault: vaultPda,
      vaultAuthority,
      signer: wallet.publicKey,
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
    } as never)
    .rpc();

  return { tx: sig, link: solscanLink(sig, network) };
}

// ─── Outflow swaps ────────────────────────────────────────────────────────────

export async function swapAssetToSol(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  assetIndex: number,
  poolAddress: PublicKey,
  assetMint: PublicKey,
  assetAta: PublicKey,
  minWsolOut: BN,
  user: PublicKey,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const { vaultPda, vaultAuthority } = deriveVaultPdas(vaultId);
  const vaultWsolAta = deriveVaultAssetAta(vaultId, WSOL_MINT);
  const redeemState = deriveRedeemStatePda(user, vaultId);
  const pool = await fetchPoolCtx(connection, poolAddress);
  const owners = ownerAccountsFor(pool, vaultWsolAta, assetMint, assetAta);
  const aToB = pool.info.tokenMintA.equals(assetMint);

  const sig = await (program.methods as any)
    .swapAssetToSol(new BN(vaultId), assetIndex, minWsolOut, aToB)
    .accounts({
      vault: vaultPda,
      vaultAuthority,
      redeemState,
      user,
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
    } as never)
    .rpc();

  return { tx: sig, link: solscanLink(sig, network) };
}

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
  const { vaultPda, vaultAuthority, usdcVault } = deriveVaultPdas(vaultId);
  const vaultWsolAta = deriveVaultAssetAta(vaultId, WSOL_MINT);
  const redeemState = deriveRedeemStatePda(user, vaultId);
  const pool = await fetchPoolCtx(connection, WSOL_USDC_POOL);
  const owners = ownerAccountsFor(pool, vaultWsolAta, USDC_MINT, usdcVault);
  const aToB = pool.info.tokenMintA.equals(WSOL_MINT);

  const sig = await (program.methods as any)
    .swapSolToUsdc(new BN(vaultId), assetIndex, wsolAmount, minUsdcOut, aToB)
    .accounts({
      vault: vaultPda,
      vaultAuthority,
      redeemState,
      usdcVault,
      user,
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
    } as never)
    .rpc();

  return { tx: sig, link: solscanLink(sig, network) };
}

export async function swapAssetToUsdc(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  assetIndex: number,
  poolAddress: PublicKey,
  assetMint: PublicKey,
  assetAta: PublicKey,
  minUsdcOut: BN,
  user: PublicKey,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const { vaultPda, vaultAuthority, usdcVault } = deriveVaultPdas(vaultId);
  const redeemState = deriveRedeemStatePda(user, vaultId);
  const pool = await fetchPoolCtx(connection, poolAddress);
  const owners = pool.info.tokenMintA.equals(assetMint)
    ? { ownerA: assetAta, ownerB: usdcVault }
    : { ownerA: usdcVault, ownerB: assetAta };
  const aToB = pool.info.tokenMintA.equals(assetMint);

  const sig = await (program.methods as any)
    .swapAssetToUsdc(new BN(vaultId), assetIndex, minUsdcOut, aToB)
    .accounts({
      vault: vaultPda,
      vaultAuthority,
      redeemState,
      usdcVault,
      user,
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
}

export async function getGlobalState(connection: Connection): Promise<GlobalStateView> {
  const program = createProgram(createDummyWallet(), connection);
  const pda = deriveGlobalStatePda();
  const gs = await (program.account as any).globalState.fetch(pda);
  return {
    isEmergency: gs.isEmergency,
    depositDisable: gs.depositDisable,
    totalVaults: gs.totalVaults.toString(),
    treasuryAddr: (gs.treasuryAddr as PublicKey).toBase58(),
    platformFeeBps: gs.platformFeeBps.toString(),
    numEligibleBaseMints: gs.numEligibleBaseMints,
  };
}

export interface VaultStateView {
  address: string;
  vaultId: string;
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
  feeds: PriceFeeds,
): Promise<NavView> {
  const program = createProgram(createDummyWallet(), connection);
  const { vaultPda } = deriveVaultPdas(vaultId);

  const result = await (program.methods as any)
    .getTotalNavView(new BN(vaultId))
    .accounts({ vault: vaultPda } as never)
    .remainingAccounts(navRemainingAccounts(vaultId, feeds))
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
  feeds: PriceFeeds,
): Promise<PreviewDepositResult> {
  const program = createProgram(createDummyWallet(), connection);
  const { vaultPda } = deriveVaultPdas(vaultId);

  const result = await (program.methods as any)
    .previewDeposit(new BN(vaultId), usdcAmount)
    .accounts({ globalState: deriveGlobalStatePda(), vault: vaultPda } as never)
    .remainingAccounts(navRemainingAccounts(vaultId, feeds))
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
  feeds: PriceFeeds,
): Promise<PreviewRedeemResult> {
  const program = createProgram(createDummyWallet(), connection);
  const { vaultPda } = deriveVaultPdas(vaultId);

  const result = await (program.methods as any)
    .previewRedeem(new BN(vaultId), shares)
    .accounts({ globalState: deriveGlobalStatePda(), vault: vaultPda } as never)
    .remainingAccounts(navRemainingAccounts(vaultId, feeds))
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

export async function ensureUserAtas(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number = DEFAULT_VAULT_ID,
  network: Network,
) {
  const { sharesMint } = deriveVaultPdas(vaultId);
  const userUsdc = usdcAta(wallet.publicKey);
  const userShares = getAssociatedTokenAddressSync(sharesMint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);

  const { VersionedTransaction, TransactionMessage } = await import('@solana/web3.js');

  const ixs = [
    createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey, userUsdc, wallet.publicKey, USDC_MINT, TOKEN_PROGRAM_ID,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey, userShares, wallet.publicKey, sharesMint, TOKEN_2022_PROGRAM_ID,
    ),
  ];

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message(),
  );

  const signed = await wallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(sig, 'confirmed');

  return { tx: sig, link: solscanLink(sig, network) };
}
