'use client';

// Address Lookup Table helpers. Deposit / redeem / genesis pack as many
// instructions as fit under Solana's 1232-byte v0 packet (and ~64-account
// lock) into one ALT-compressed transaction so the user signs fewer txs.
// Baskets that still overflow split greedily (see MULTI_TX_ASSET_THRESHOLD).

import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SendTransactionError,
  SystemProgram,
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

/** Dummy blockhash for dry-run size checks (same byte length as a real one). */
const PACK_PROBE_BLOCKHASH = '11111111111111111111111111111111';

/**
 * Solana runtime hard limit on accounts locked by one transaction.
 * ALT compresses the **wire** size; it does **not** raise this lock cap.
 * @see https://docs.solana.com/developing/programming-model/transactions
 */
export const MAX_TX_ACCOUNT_LOCKS = 64;

/**
 * Soft cap used when packing. Leave a small headroom under 64 so a missed
 * program-derived account or compute-budget key doesn't trip simulation.
 */
export const SAFE_TX_ACCOUNT_LOCKS = 60;

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
 * Count unique accounts a compiled v0 message will lock (static keys + every
 * ALT index). This is what Solana enforces at `MAX_TX_ACCOUNT_LOCKS` (64) —
 * independent of packet size / ALT compression.
 */
export function countLockedAccounts(
  payer: PublicKey,
  ixs: TransactionInstruction[],
  lut?: AddressLookupTableAccount | null,
  recentBlockhash: string = PACK_PROBE_BLOCKHASH,
): number {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ...ixs,
    ],
  }).compileToV0Message(lut ? [lut] : []);

  let n = message.staticAccountKeys.length;
  for (const lookup of message.addressTableLookups) {
    n += lookup.writableIndexes.length + lookup.readonlyIndexes.length;
  }
  return n;
}

/**
 * Compile one unsigned v0 transaction (compute budget prepended). Keys present
 * in `lut` compress to 1-byte indices. Throws if the serialized packet exceeds
 * Solana’s 1232-byte limit **or** the account lock set exceeds 64.
 */
export function buildV0(
  payer: PublicKey,
  recentBlockhash: string,
  ixs: TransactionInstruction[],
  lut?: AddressLookupTableAccount | null,
): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ...ixs,
    ],
  }).compileToV0Message(lut ? [lut] : []);

  let locked = message.staticAccountKeys.length;
  for (const lookup of message.addressTableLookups) {
    locked += lookup.writableIndexes.length + lookup.readonlyIndexes.length;
  }
  if (locked > MAX_TX_ACCOUNT_LOCKS) {
    throw new Error(
      `Transaction locks ${locked} accounts (max ${MAX_TX_ACCOUNT_LOCKS}). ` +
        `${ixs.length} instruction(s) — split into smaller batches` +
        (lut ? ' (ALT shrinks bytes, not the lock count).' : '.'),
    );
  }

  const tx = new VersionedTransaction(message);
  let txBytes: Uint8Array;
  try {
    txBytes = tx.serialize();
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const isOverrun = /encoding overruns (Buffer|Uint8Array)/i.test(raw);
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
  return tx;
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
  const tx = buildV0(wallet.publicKey, latest.blockhash, ixs, lut);

  let signed: VersionedTransaction;
  try {
    signed = (await wallet.signTransaction(tx)) as VersionedTransaction;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errName =
      err instanceof Error && err.constructor?.name ? err.constructor.name : 'SignError';
    let size = 0;
    try {
      size = tx.serialize().length;
    } catch {
      /* ignore */
    }
    throw new Error(
      `Wallet could not sign transaction (${errName}): ${msg} ` +
        `(${ixs.length} ix, ${size} bytes${lut ? ', ALT' : ', no ALT'}).`,
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

/**
 * True when `ixs` fit **both** envelopes:
 * 1. ≤ `SAFE_TX_ACCOUNT_LOCKS` unique locked accounts (runtime hard limit is 64)
 * 2. serialize to a v0 packet ≤ 1232 bytes with optional ALT
 *
 * ALT only helps (2). Overpacking past (1) surfaces as
 * "Transaction locked too many accounts" at simulation.
 */
export function fitsV0(
  payer: PublicKey,
  ixs: TransactionInstruction[],
  lut?: AddressLookupTableAccount | null,
  recentBlockhash: string = PACK_PROBE_BLOCKHASH,
): boolean {
  if (ixs.length === 0) return true;
  try {
    const locked = countLockedAccounts(payer, ixs, lut, recentBlockhash);
    if (locked > SAFE_TX_ACCOUNT_LOCKS) return false;
    buildV0(payer, recentBlockhash, ixs, lut);
    return true;
  } catch {
    return false;
  }
}

/**
 * Greedy pack: put as many consecutive instructions as possible into each
 * ALT v0 transaction without exceeding the account-lock soft cap or the
 * 1232-byte packet. Minimizes signatures for multi-leg deposit/genesis.
 */
export function packIxsForAlt(
  payer: PublicKey,
  ixs: TransactionInstruction[],
  lut?: AddressLookupTableAccount | null,
): TransactionInstruction[][] {
  if (ixs.length === 0) return [];

  // Fast path — everything fits in one packet under both limits.
  if (fitsV0(payer, ixs, lut)) return [ixs];

  const batches: TransactionInstruction[][] = [];
  let start = 0;
  while (start < ixs.length) {
    // Binary search the longest prefix [start, end) that still fits.
    let lo = start + 1;
    let hi = ixs.length;
    let best = start + 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (fitsV0(payer, ixs.slice(start, mid), lut)) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best <= start) {
      let locked = 0;
      try {
        locked = countLockedAccounts(payer, [ixs[start]!], lut);
      } catch {
        /* ignore */
      }
      throw new Error(
        `Instruction ${start + 1}/${ixs.length} alone exceeds Solana v0 limits` +
          (locked ? ` (locks ~${locked} accounts, max ${MAX_TX_ACCOUNT_LOCKS})` : '') +
          (lut ? ' even with the vault ALT' : ' — pass a vault ALT to compress keys') +
          '. Split the basket or reduce swap accounts.',
      );
    }
    batches.push(ixs.slice(start, best));
    start = best;
  }
  return batches;
}

function isTooManyAccountsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /locked too many accounts|MaxLoadedAccounts|too many accounts/i.test(msg);
}

/**
 * Pack `ixs` into the fewest ALT v0 transactions that fit under the account
 * lock + packet size, then send each sequentially (confirm before the next —
 * later legs often depend on earlier state, e.g. deposit → swaps).
 *
 * If a batch still fails simulation with "too many accounts" (edge case),
 * that batch is split in half and retried.
 */
export async function sendV0Packed(
  connection: Connection,
  wallet: AnchorWallet,
  ixs: TransactionInstruction[],
  lut?: AddressLookupTableAccount | null,
  onProgress?: (msg: string) => void,
): Promise<string[]> {
  if (ixs.length === 0) return [];

  const batches = packIxsForAlt(wallet.publicKey, ixs, lut);
  const lockHint =
    batches.length === 1
      ? (() => {
          try {
            return countLockedAccounts(wallet.publicKey, batches[0]!, lut);
          } catch {
            return null;
          }
        })()
      : null;

  if (batches.length === 1) {
    onProgress?.(
      `Sending 1 ALT transaction (${batches[0]!.length} ix` +
        (lockHint != null ? `, ${lockHint} accounts locked` : '') +
        ')…',
    );
  } else {
    onProgress?.(
      `Packed ${ixs.length} instruction(s) into ${batches.length} ALT transactions ` +
        `(≤${SAFE_TX_ACCOUNT_LOCKS} accounts / 1232 bytes each)…`,
    );
  }

  const sigs: string[] = [];

  const sendBatch = async (
    batch: TransactionInstruction[],
    label: string,
  ): Promise<void> => {
    try {
      onProgress?.(label);
      sigs.push(await sendV0(connection, wallet, batch, lut));
    } catch (err) {
      if (isTooManyAccountsError(err) && batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        onProgress?.(
          `Too many accounts locked (${batch.length} ix) — splitting and retrying…`,
        );
        await sendBatch(
          batch.slice(0, mid),
          `Retry half A (${mid} ix)…`,
        );
        await sendBatch(
          batch.slice(mid),
          `Retry half B (${batch.length - mid} ix)…`,
        );
        return;
      }
      throw err;
    }
  };

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    let locked: number | null = null;
    try {
      locked = countLockedAccounts(wallet.publicKey, batch, lut);
    } catch {
      /* ignore */
    }
    await sendBatch(
      batch,
      `ALT tx ${i + 1}/${batches.length} (${batch.length} ix` +
        (locked != null ? `, ~${locked} accounts` : '') +
        ')…',
    );
  }
  return sigs;
}
