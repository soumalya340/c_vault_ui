import {
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getMint,
} from '@solana/spl-token';
import BN from 'bn.js';

export async function resolveTokenProgram(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint, 'confirmed');
  if (!info) {
    throw new Error(`Token mint not found: ${mint.toBase58()}`);
  }
  if (
    !info.owner.equals(TOKEN_PROGRAM_ID) &&
    !info.owner.equals(TOKEN_2022_PROGRAM_ID)
  ) {
    throw new Error(
      `Account ${mint.toBase58()} is not an SPL mint (owner ${info.owner.toBase58()})`,
    );
  }
  return info.owner;
}

export async function resolveMintDecimals(
  connection: Connection,
  mint: PublicKey,
  tokenProgram: PublicKey,
  decimalsOverride?: number,
): Promise<number> {
  if (decimalsOverride != null) {
    if (!Number.isInteger(decimalsOverride) || decimalsOverride < 0 || decimalsOverride > 12) {
      throw new Error(`Invalid token decimals override: ${decimalsOverride}`);
    }
    return decimalsOverride;
  }
  const mintAccount = await getMint(
    connection,
    mint,
    'confirmed',
    tokenProgram,
  );
  return mintAccount.decimals;
}

/** Human UI amount → raw BN, e.g. ("1.5", 6) → 1500000. */
export function parseUiAmount(amount: string, decimals: number): BN {
  const trimmed = amount.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length > decimals) {
    throw new Error(
      `Amount ${amount} has more than ${decimals} decimal places`,
    );
  }
  const fracPadded = frac.padEnd(decimals, '0');
  const raw = `${whole}${fracPadded}`.replace(/^0+(?=\d)/, '');
  return new BN(raw === '' ? '0' : raw);
}

export function applySlippageMax(amount: BN, slippagePercent: number): BN {
  if (slippagePercent < 0) {
    throw new Error(`slippagePercent must be >= 0, got ${slippagePercent}`);
  }
  if (slippagePercent === 0) return amount;
  // amount * (1 + slippage/100) with 1e6 fixed-point to avoid float error
  const bps = Math.round(slippagePercent * 100); // percent → bps (1% = 100)
  return amount.muln(10_000 + bps).divn(10_000);
}

/**
 * Attach recent blockhash + fee payer so the tx is ready for wallet signing.
 * Does not sign.
 */
export async function prepareTransaction(
  connection: Connection,
  tx: Transaction,
  feePayer: PublicKey,
): Promise<Transaction> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash('confirmed');
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;
  // Stash for callers that confirm via lastValidBlockHeight (see lib/confirm.ts).
  (tx as Transaction & { lastValidBlockHeight?: number }).lastValidBlockHeight =
    lastValidBlockHeight;
  return tx;
}

export function assertPositiveAmount(amount: BN, label: string): void {
  if (amount.isNeg() || amount.isZero()) {
    throw new Error(`${label} must be a positive amount`);
  }
}
