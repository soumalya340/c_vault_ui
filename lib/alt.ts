'use client';

// Address Lookup Table helpers. Devnet has no bundle support, so deposit and
// redeem swap legs are packed into single v0 transactions instead — the ALT
// created at vault-creation time (Plan.md §6) is what makes those fit.

import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { SystemProgram } from '@solana/web3.js';

import {
  WHIRLPOOL_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  DAMM_V2_POOL_AUTHORITY,
  DAMM_V2_EVENT_AUTHORITY,
  MEMO_PROGRAM_ID,
  WSOL_MINT,
  USDC_MINT,
} from './constants';
import type { PoolCtx } from './whirlpool';
import type { DammPoolCtx } from './damm';
import { confirmBySignaturePolling } from './confirm';

const EXTEND_BATCH = 20;

function dedupe(keys: PublicKey[]): PublicKey[] {
  const seen = new Set<string>();
  return keys.filter((k) => {
    const b58 = k.toBase58();
    if (seen.has(b58)) return false;
    seen.add(b58);
    return true;
  });
}

/**
 * Everything the deposit/redeem swap legs reference for one vault: programs,
 * vault PDAs, mints, vault asset ATAs, price feeds, and each pool's state
 * accounts (vaults, oracle, tick arrays). User-specific accounts are NOT
 * included — they stay as static keys in the v0 message.
 */
export function buildVaultAltAddresses(params: {
  globalState: PublicKey;
  vaultPda: PublicKey;
  vaultAuthority: PublicKey;
  sharesMint: PublicKey;
  usdcVault: PublicKey;
  baseMint?: PublicKey;
  assetMints: PublicKey[];
  vaultAssetAtas: PublicKey[];
  priceFeeds: PublicKey[];
  pools: PoolCtx[];
  dammPools?: DammPoolCtx[];
  extraKeys?: PublicKey[];
}): PublicKey[] {
  return dedupe([
    SystemProgram.programId,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    WHIRLPOOL_PROGRAM_ID,
    DAMM_V2_PROGRAM_ID,
    DAMM_V2_POOL_AUTHORITY,
    DAMM_V2_EVENT_AUTHORITY,
    MEMO_PROGRAM_ID,
    params.globalState,
    params.vaultPda,
    params.vaultAuthority,
    params.sharesMint,
    params.usdcVault,
    params.baseMint ?? USDC_MINT,
    WSOL_MINT,
    ...params.assetMints,
    ...params.vaultAssetAtas,
    ...params.priceFeeds,
    ...params.pools.flatMap((p) => [
      p.address,
      p.info.tokenVaultA,
      p.info.tokenVaultB,
      p.info.tokenMintA,
      p.info.tokenMintB,
      p.oracle,
      ...p.tickArrays,
    ]),
    ...(params.dammPools ?? []).flatMap((p) => [
      p.address,
      p.info.tokenVaultA,
      p.info.tokenVaultB,
      p.info.tokenMintA,
      p.info.tokenMintB,
    ]),
    ...(params.extraKeys ?? []),
  ]);
}

/**
 * Create a lookup table and extend it with `addresses`. All transactions are
 * signed in one wallet prompt (signAllTransactions) and landed sequentially.
 * Returns the table address once it is on chain.
 */
export async function createVaultAlt(
  connection: Connection,
  wallet: AnchorWallet,
  addresses: PublicKey[],
): Promise<PublicKey> {
  const authority = wallet.publicKey;
  const slot = await connection.getSlot('finalized');
  const [createIx, lutAddress] = AddressLookupTableProgram.createLookupTable({
    authority,
    payer: authority,
    recentSlot: slot,
  });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

  const txs: Transaction[] = [new Transaction().add(createIx)];
  for (let i = 0; i < addresses.length; i += EXTEND_BATCH) {
    txs.push(
      new Transaction().add(
        AddressLookupTableProgram.extendLookupTable({
          payer: authority,
          authority,
          lookupTable: lutAddress,
          addresses: addresses.slice(i, i + EXTEND_BATCH),
        }),
      ),
    );
  }
  for (const tx of txs) {
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = authority;
  }

  // Sign every tx in a single wallet prompt, then land them one at a time.
  // Each is confirmed by polling signature status (not the flaky public-RPC
  // websocket) so a slow-to-confirm create/extend doesn't trip the 30s
  // "not confirmed" error. The extend txs depend on the create landing first,
  // so ordering is preserved.
  const signed = await wallet.signAllTransactions(txs);
  for (const tx of signed) {
    const raw = tx.serialize();
    const sig = await connection.sendRawTransaction(raw, {
      skipPreflight: false,
      maxRetries: 5,
    });
    await confirmBySignaturePolling(connection, sig, { lastValidBlockHeight });
  }

  return lutAddress;
}

/** Fetch an ALT account for use in a v0 message; null when it doesn't exist. */
export async function fetchAlt(
  connection: Connection,
  address: PublicKey,
): Promise<AddressLookupTableAccount | null> {
  return (await connection.getAddressLookupTable(address)).value;
}

/**
 * Compile, sign (wallet), send, and confirm one v0 transaction. Keys present
 * in `lut` are compressed to 1-byte indices; everything else stays static.
 * A max compute-budget instruction is prepended — multi-swap bundles need it.
 */
export async function sendV0(
  connection: Connection,
  wallet: AnchorWallet,
  ixs: TransactionInstruction[],
  lut?: AddressLookupTableAccount | null,
): Promise<string> {
  const latest = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ...ixs,
    ],
  }).compileToV0Message(lut ? [lut] : []);

  const tx = new VersionedTransaction(message);
  const signed = (await wallet.signTransaction(tx)) as VersionedTransaction;
  const sig = await connection.sendTransaction(signed, {
    skipPreflight: false,
    maxRetries: 5,
  });
  // Poll signature status instead of relying on the websocket subscription —
  // the public devnet RPC drops those under load, which surfaces as the 30s
  // "not confirmed / unknown if it succeeded" error even when the tx landed.
  await confirmBySignaturePolling(connection, sig, {
    lastValidBlockHeight: latest.lastValidBlockHeight,
  });
  return sig;
}
