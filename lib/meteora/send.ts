import type {
  Connection,
  Keypair,
  PublicKey,
  SendOptions,
  Transaction,
  TransactionSignature,
} from '@solana/web3.js';
import { confirmBySignaturePolling } from '@/lib/confirm';
import { prepareTransaction } from './utils';

export type WalletSigner = {
  publicKey: PublicKey;
  signTransaction?: (tx: Transaction) => Promise<Transaction>;
  /**
   * Wallet-adapter `sendTransaction` — preferred for Phantom. Supports
   * co-signers (position NFT) without a fragile partialSign + re-sign path.
   */
  sendTransaction?: (
    transaction: Transaction,
    connection: Connection,
    options?: SendOptions & { signers?: Keypair[] },
  ) => Promise<TransactionSignature>;
};

type PreparedTx = Transaction & { lastValidBlockHeight?: number };

function isUserReject(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /reject|denied|cancel|User rejected|Approval Denied/i.test(msg);
}

/**
 * Co-sign a legacy DAMM v2 transaction with optional keypairs (position NFT),
 * then wallet-sign, send, and confirm via HTTP polling.
 *
 * Prefers `wallet.sendTransaction(..., { signers })` so Phantom/Solflare show
 * the approval popup reliably. Falls back to partialSign + signTransaction.
 */
export async function sendMeteoraTx(
  connection: Connection,
  wallet: WalletSigner,
  tx: Transaction,
  extraSigners: Keypair[] = [],
): Promise<string> {
  if (!wallet.publicKey) {
    throw new Error('Wallet not connected');
  }

  // Fresh blockhash right before the user sees the popup.
  await prepareTransaction(connection, tx, wallet.publicKey);
  const lastValidBlockHeight =
    (tx as PreparedTx).lastValidBlockHeight ??
    (await connection.getLatestBlockhash('confirmed')).lastValidBlockHeight;

  // ── Preferred path: adapter sendTransaction (Phantom prompts here) ──────
  if (typeof wallet.sendTransaction === 'function') {
    try {
      const signature = await wallet.sendTransaction(tx, connection, {
        signers: extraSigners,
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 5,
      });
      await confirmBySignaturePolling(connection, signature, {
        lastValidBlockHeight,
      });
      return signature;
    } catch (err) {
      if (isUserReject(err)) {
        throw new Error(
          'Wallet approval was rejected. Approve the transaction in Phantom to stake.',
        );
      }
      throw err;
    }
  }

  // ── Fallback: partial-sign NFT, then wallet.signTransaction ─────────────
  if (!wallet.signTransaction) {
    throw new Error(
      'Wallet cannot sign transactions. Reconnect Phantom and try again.',
    );
  }

  if (extraSigners.length > 0) {
    tx.partialSign(...extraSigners);
  }

  let signed: Transaction;
  try {
    signed = await wallet.signTransaction(tx);
  } catch (err) {
    if (isUserReject(err)) {
      throw new Error(
        'Wallet approval was rejected. Approve the transaction in Phantom to stake.',
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Wallet did not sign the stake transaction: ${msg}. ` +
        'Open Phantom, unlock it, and try Stake & Earn again.',
    );
  }

  const raw = signed.serialize();
  const signature = await connection.sendRawTransaction(raw, {
    skipPreflight: false,
    maxRetries: 5,
  });

  await confirmBySignaturePolling(connection, signature, {
    lastValidBlockHeight,
  });

  return signature;
}
