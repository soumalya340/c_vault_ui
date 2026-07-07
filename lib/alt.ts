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

import { WHIRLPOOL_PROGRAM_ID, WSOL_MINT } from './constants';
import type { PoolCtx } from './whirlpool';

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
  baseMint: PublicKey;
  assetMints: PublicKey[];
  vaultAssetAtas: PublicKey[];
  priceFeeds: PublicKey[];
  pools: PoolCtx[];
}): PublicKey[] {
  return dedupe([
    SystemProgram.programId,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    WHIRLPOOL_PROGRAM_ID,
    params.globalState,
    params.vaultPda,
    params.vaultAuthority,
    params.sharesMint,
    params.usdcVault,
    params.baseMint,
    WSOL_MINT,
    ...params.assetMints,
    ...params.vaultAssetAtas,
    ...params.priceFeeds,
    ...params.pools.flatMap((p) => [
      p.address,
      p.info.tokenVaultA,
      p.info.tokenVaultB,
      p.oracle,
      ...p.tickArrays,
    ]),
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

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

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

  const signed = await wallet.signAllTransactions(txs);
  for (const tx of signed) {
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      'confirmed',
    );
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
  const latest = await connection.getLatestBlockhash();
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
  const sig = await connection.sendTransaction(signed);
  await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
  return sig;
}
