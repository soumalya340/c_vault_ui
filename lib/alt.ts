'use client';

// Address Lookup Table helpers. Devnet has no bundle support, so deposit and
// redeem swap legs use v0 transactions with the vault ALT. Baskets with >4
// assets split across multiple txs (see MULTI_TX_ASSET_THRESHOLD / Rules.md).

import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SendTransactionError,
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
  C_VAULT_PROGRAM_ID,
  WHIRLPOOL_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  DAMM_V2_POOL_AUTHORITY,
  DAMM_V2_EVENT_AUTHORITY,
  MEMO_PROGRAM_ID,
  WSOL_MINT,
} from './constants';
import type { PoolCtx } from './whirlpool';
import type { DammPoolCtx } from './damm';
import { confirmBySignaturePolling } from './confirm';
import { probeClusterHealth } from './clusterHealth';

function isLocalRpc(connection: Connection): boolean {
  const endpoint = connection.rpcEndpoint ?? '';
  return /127\.0\.0\.1|localhost/.test(endpoint);
}

async function assertLocalProgramDeployed(connection: Connection): Promise<void> {
  const health = await probeClusterHealth(connection);
  const programShort = `${C_VAULT_PROGRAM_ID.toBase58().slice(0, 8)}…`;
  if (!health.rpcOnline) {
    throw new Error(
      `Local validator is offline (${connection.rpcEndpoint}). Start Surfpool or solana-test-validator, then recheck in the nav.`,
    );
  }
  if (!health.programDeployed) {
    throw new Error(
      `c_vault program (${programShort}) is not deployed on your local validator (slot ${health.slot ?? '—'}). ` +
        'Deploy from `c_vault/` (`anchor build` then `solana program deploy`), or switch the UI network to mainnet.',
    );
  }
}

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
  /** Quote mint of the vault's cluster — pass `NETWORK_CONSTANTS[network].usdcMint`. */
  baseMint: PublicKey;
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
    params.baseMint,
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
  if (isLocalRpc(connection)) {
    await assertLocalProgramDeployed(connection);
  }

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
  let txBytes: Uint8Array;
  try {
    txBytes = tx.serialize();
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const isOverrun = /encoding overruns (Buffer|Uint8Array)/i.test(raw);
    // create_etf has no vault ALT yet — oversize ix data (esp. data: URIs) is
    // the usual cause, not a missing lookup table.
    const hint = lut
      ? `${ixs.length} instruction(s) — split into smaller batches.`
      : isOverrun
        ? `${ixs.length} instruction(s) — transaction payload is too large for Solana’s 1232-byte packet. ` +
          `For Create ETF: use a short https:// metadata URI (not a base64 data: image).`
        : `${ixs.length} instruction(s) — pass the vault ALT to compress account keys.`;
    throw new Error(`Transaction encoding failed (${raw}). ${hint}`);
  }
  if (txBytes.length > 1232) {
    throw new Error(
      `Transaction too large (${txBytes.length} bytes, max 1232). ${ixs.length} instruction(s).` +
        (lut ? ' Split into smaller batches.' : ' Use the vault ALT.'),
    );
  }

  let signed: VersionedTransaction;
  try {
    signed = (await wallet.signTransaction(tx)) as VersionedTransaction;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errName =
      err instanceof Error && err.constructor?.name ? err.constructor.name : 'SignError';
    throw new Error(
      `Wallet could not sign transaction (${errName}): ${msg} ` +
        `(${ixs.length} ix, ${txBytes.length} bytes${lut ? ', ALT' : ', no ALT'}).`,
    );
  }
  let sig: string;
  try {
    sig = await connection.sendTransaction(signed, {
      skipPreflight: false,
      maxRetries: 5,
    });
  } catch (err) {
    if (err instanceof SendTransactionError) {
      const logs = err.logs?.length ? err.logs : undefined;
      const detail = logs?.length ? `\nLogs:\n${logs.join('\n')}` : '';
      throw new Error(`${err.message}${detail}`);
    }
    throw err;
  }
  // Poll signature status instead of relying on the websocket subscription —
  // the public devnet RPC drops those under load, which surfaces as the 30s
  // "not confirmed / unknown if it succeeded" error even when the tx landed.
  await confirmBySignaturePolling(connection, sig, {
    lastValidBlockHeight: latest.lastValidBlockHeight,
  });
  return sig;
}
