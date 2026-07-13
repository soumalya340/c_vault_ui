'use client';

import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Idl } from '@coral-xyz/anchor';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import idlJson from '@/idl/c_vault.json';

/** Program address comes from the IDL (`7wcJ…`) — must match C_VAULT_PROGRAM_ID / PDA seeds. */
function loadIdl(): Idl {
  return idlJson as unknown as Idl;
}

export function createProgram(wallet: AnchorWallet, connection: Connection): Program<any> {
  const provider = new AnchorProvider(connection, wallet, AnchorProvider.defaultOptions());
  return new Program(loadIdl(), provider);
}

export function createDummyWallet(): AnchorWallet {
  return {
    publicKey: PublicKey.default,
    signTransaction: async (tx) => tx,
    signAllTransactions: async (txs) => txs,
  } as AnchorWallet;
}
