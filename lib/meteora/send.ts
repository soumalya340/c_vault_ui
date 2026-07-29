import type { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { confirmBySignaturePolling } from '@/lib/confirm';

export type WalletSigner = {
  publicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
};

type PreparedTx = Transaction & { lastValidBlockHeight?: number };

/**
 * Co-sign a legacy DAMM v2 transaction with optional keypairs (position NFT),
 * then wallet-sign, send, and confirm via HTTP polling.
 */
export async function sendMeteoraTx(
  connection: Connection,
  wallet: WalletSigner,
  tx: Transaction,
  extraSigners: Keypair[] = [],
): Promise<string> {
  if (!wallet.signTransaction) {
    throw new Error('Wallet does not support signTransaction');
  }

  if (extraSigners.length > 0) {
    tx.partialSign(...extraSigners);
  }

  const signed = await wallet.signTransaction(tx);
  const raw = signed.serialize();

  let lastValidBlockHeight = (tx as PreparedTx).lastValidBlockHeight;
  if (lastValidBlockHeight == null) {
    const latest = await connection.getLatestBlockhash('confirmed');
    lastValidBlockHeight = latest.lastValidBlockHeight;
  }

  const signature = await connection.sendRawTransaction(raw, {
    skipPreflight: false,
    maxRetries: 5,
  });

  await confirmBySignaturePolling(connection, signature, {
    lastValidBlockHeight,
  });

  return signature;
}
