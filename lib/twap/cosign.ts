/**
 * Client helper: build a v0 tx (user = fee payer), wallet-sign first, then
 * cosign with server-held TWAP keeper and send.
 *
 * Order matters: many browser wallets re-serialize and drop non-wallet
 * signatures if the keeper signs before the wallet.
 */

import {
  ComputeBudgetProgram,
  Connection,
  SendTransactionError,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
} from '@solana/web3.js';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import { confirmBySignaturePolling } from '../confirm';

function isLocalRpc(connection: Connection): boolean {
  const ep = (connection as unknown as { _rpcEndpoint?: string })._rpcEndpoint ?? '';
  return /localhost|127\.0\.0\.1/.test(ep);
}

async function assertLocalProgramDeployed(connection: Connection): Promise<void> {
  void connection;
}

function serializePartial(tx: VersionedTransaction): string {
  return Buffer.from(
    (tx as unknown as { serialize: (o?: object) => Uint8Array }).serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
  ).toString('base64');
}

/**
 * Multi-signer path for a **batch** of `update_dex_twap` instructions.
 *
 * All `ixs` land in **one** v0 transaction (not one tx per asset). Each ix is
 * tiny (program + 4 accounts + 16 bytes of args), so 9 of them easily fit
 * under the 1232-byte packet limit without an ALT.
 *
 * Signers (2 total, independent of ix count):
 * - fee payer = connected wallet (depositor) — signs first
 * - keeper = server cosign (`/api/twap/cosign`) — signs second
 */
export async function sendV0WithTwapKeeperCosign(
  connection: Connection,
  wallet: AnchorWallet,
  ixs: TransactionInstruction[],
  lut?: AddressLookupTableAccount | null,
): Promise<string> {
  if (!ixs.length) {
    throw new Error('sendV0WithTwapKeeperCosign: empty instruction list');
  }
  if (ixs.length > 9) {
    throw new Error(
      `sendV0WithTwapKeeperCosign: ${ixs.length} ixs exceeds max 9 (vault asset cap)`,
    );
  }

  if (isLocalRpc(connection)) {
    await assertLocalProgramDeployed(connection);
  }

  const latest = await connection.getLatestBlockhash('confirmed');
  // One message, N instructions — Solana executes them atomically in order.
  const message = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ...ixs,
    ],
  }).compileToV0Message(lut ? [lut] : []);

  const unsigned = new VersionedTransaction(message);
  // 1) Depositor / fee payer signs first.
  const userSigned = (await wallet.signTransaction(unsigned)) as VersionedTransaction;

  // 2) Server adds keeper signature (does not re-send).
  const res = await fetch('/api/twap/cosign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: serializePartial(userSigned) }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    transaction?: string;
    error?: string;
  };
  if (!res.ok || !body.transaction) {
    throw new Error(body.error || `TWAP keeper cosign failed (HTTP ${res.status})`);
  }

  const fullySigned = VersionedTransaction.deserialize(
    Buffer.from(body.transaction, 'base64'),
  );

  let sig: string;
  try {
    sig = await connection.sendTransaction(fullySigned, {
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

  await confirmBySignaturePolling(connection, sig, {
    lastValidBlockHeight: latest.lastValidBlockHeight,
  });
  return sig;
}
