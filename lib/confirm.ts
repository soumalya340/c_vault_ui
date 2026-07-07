'use client';

// Robust transaction confirmation for the public devnet RPC.
//
// web3.js's `connection.confirmTransaction` relies on a websocket signature
// subscription and gives up after ~30s with "Transaction was not confirmed in
// 30.00 seconds. It is unknown if it succeeded or failed." The public devnet
// endpoint drops/throttles those subscriptions under load, so the wait times
// out even though the transaction landed. We poll `getSignatureStatuses`
// instead — HTTP polling survives flaky websockets — and stop early once the
// blockhash's last-valid height passes (a real, non-ambiguous expiry).

import type { Connection, TransactionSignature } from '@solana/web3.js';

export interface ConfirmOpts {
  /** Blockhash validity bound — poll stops once the chain passes this height. */
  lastValidBlockHeight: number;
  /** Overall wall-clock cap (ms) before giving up. Default 90s. */
  timeoutMs?: number;
  /** Gap between status polls (ms). Default 2s (public-RPC rate-limit friendly). */
  pollIntervalMs?: number;
}

/**
 * Wait for `signature` to reach `confirmed` (or better) by polling signature
 * status. Resolves on success; throws on an on-chain error, on blockhash
 * expiry without confirmation, or on timeout.
 */
export async function confirmBySignaturePolling(
  connection: Connection,
  signature: TransactionSignature,
  { lastValidBlockHeight, timeoutMs = 90_000, pollIntervalMs = 2_000 }: ConfirmOpts,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: false,
    });
    const status = value[0];

    if (status) {
      if (status.err) {
        throw new Error(
          `Transaction ${signature} failed on-chain: ${JSON.stringify(status.err)}`,
        );
      }
      if (
        status.confirmationStatus === 'confirmed' ||
        status.confirmationStatus === 'finalized'
      ) {
        return;
      }
    }

    // Not confirmed yet — if the blockhash has expired the tx can never land,
    // so stop waiting. (Only trust this once the tx isn't already known.)
    if (!status) {
      let height: number;
      try {
        height = await connection.getBlockHeight('confirmed');
      } catch {
        height = 0; // RPC hiccup — keep polling, don't declare expiry
      }
      if (height > lastValidBlockHeight) {
        throw new Error(
          `Transaction ${signature} expired (blockhash no longer valid) before confirming.`,
        );
      }
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(
    `Transaction ${signature} not confirmed within ${Math.round(
      timeoutMs / 1000,
    )}s. Check it on Solscan — it may still have succeeded.`,
  );
}
