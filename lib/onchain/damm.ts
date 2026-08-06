import { AccountInfo, Connection, PublicKey } from '@solana/web3.js';
import { DAMM_V2_PROGRAM_ID } from '../constants';

// Offsets from c_vault `utils/dex_price.rs` (Pool layout after 8-byte disc).
const TOKEN_A_MINT = 168;
const TOKEN_B_MINT = 200;
const TOKEN_A_VAULT = 232;
const TOKEN_B_VAULT = 264;

export interface DammPoolInfo {
  tokenMintA: PublicKey;
  tokenMintB: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
}

export function parseDammPool(data: Buffer): DammPoolInfo {
  return {
    tokenMintA: new PublicKey(data.subarray(TOKEN_A_MINT, TOKEN_A_MINT + 32)),
    tokenMintB: new PublicKey(data.subarray(TOKEN_B_MINT, TOKEN_B_MINT + 32)),
    tokenVaultA: new PublicKey(data.subarray(TOKEN_A_VAULT, TOKEN_A_VAULT + 32)),
    tokenVaultB: new PublicKey(data.subarray(TOKEN_B_VAULT, TOKEN_B_VAULT + 32)),
  };
}

export interface DammPoolCtx {
  address: PublicKey;
  info: DammPoolInfo;
}

async function fetchAccountOrThrow(
  connection: Connection,
  address: PublicKey,
  label: string,
): Promise<AccountInfo<Buffer>> {
  const info = await connection.getAccountInfo(address);
  if (!info) throw new Error(`${label} (${address.toBase58()}) not found`);
  return info;
}

export async function fetchDammPoolCtx(
  connection: Connection,
  pool: PublicKey,
): Promise<DammPoolCtx> {
  const accountInfo = await fetchAccountOrThrow(connection, pool, 'DAMM v2 pool');
  if (!accountInfo.owner.equals(DAMM_V2_PROGRAM_ID)) {
    throw new Error(
      `Pool ${pool.toBase58()} is not owned by DAMM v2 (${DAMM_V2_PROGRAM_ID.toBase58()})`,
    );
  }
  return {
    address: pool,
    info: parseDammPool(accountInfo.data),
  };
}

/** Infer trade direction accounts: input is sold, output is bought. */
export function dammOwnerAccounts(
  pool: DammPoolCtx,
  inputAccount: PublicKey,
  inputMint: PublicKey,
  outputAccount: PublicKey,
): { input: PublicKey; output: PublicKey } {
  const isA = pool.info.tokenMintA.equals(inputMint);
  const isB = pool.info.tokenMintB.equals(inputMint);
  if (!isA && !isB) {
    throw new Error(
      `DAMM pool ${pool.address.toBase58()} does not include mint ${inputMint.toBase58()}`,
    );
  }
  return { input: inputAccount, output: outputAccount };
}
