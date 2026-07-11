'use client';

import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Idl } from '@coral-xyz/anchor';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import idlJson from '@/idl/c_vault.json';
import { NETWORK_CONSTANTS, type Network } from './constants';

/**
 * The IDL's embedded `address` field is what Anchor's `Program` constructor
 * uses to know which program to talk to — mainnet and devnet are separate
 * deployments, so it must be overridden per network rather than trusting the
 * mainnet address baked into idl/c_vault.json.
 */
function loadIdl(network: Network): Idl {
  return {
    ...(idlJson as unknown as Idl),
    address: NETWORK_CONSTANTS[network].programId.toBase58(),
  };
}

export function createProgram(
  wallet: AnchorWallet,
  connection: Connection,
  network: Network = 'mainnet',
): Program<any> {
  const provider = new AnchorProvider(connection, wallet, AnchorProvider.defaultOptions());
  return new Program(loadIdl(network), provider);
}

export function createDummyWallet(): AnchorWallet {
  return {
    publicKey: PublicKey.default,
    signTransaction: async (tx) => tx,
    signAllTransactions: async (txs) => txs,
  } as AnchorWallet;
}
