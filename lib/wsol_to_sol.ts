import { Connection, TransactionInstruction } from '@solana/web3.js';
import {
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import type { AnchorWallet } from '@solana/wallet-adapter-react';

import { WSOL_MINT } from './constants';
import { sendV0 } from './alt';
import { solscanLink, type Network } from './solscanLink';

/**
 * Closing the wallet's wSOL ATA releases its wrapped-SOL balance (and the
 * account's rent) back as native SOL to the same wallet, in one instruction.
 */
export async function unwrapWsol(
  connection: Connection,
  wallet: AnchorWallet,
  network: Network,
): Promise<{ tx: string; link: string; lamports: bigint }> {
  const wsolAta = getAssociatedTokenAddressSync(WSOL_MINT, wallet.publicKey, false, TOKEN_PROGRAM_ID);

  const account = await connection.getAccountInfo(wsolAta);
  if (!account) {
    throw new Error('No wSOL account found — nothing to unwrap.');
  }

  const balance = await connection.getTokenAccountBalance(wsolAta);
  const lamports = BigInt(balance.value.amount);
  if (lamports === 0n) {
    throw new Error('wSOL balance is zero — nothing to unwrap.');
  }

  const ixs: TransactionInstruction[] = [
    createCloseAccountInstruction(wsolAta, wallet.publicKey, wallet.publicKey, [], TOKEN_PROGRAM_ID),
  ];

  const sig = await sendV0(connection, wallet, ixs);
  return { tx: sig, link: solscanLink(sig, network), lamports };
}
