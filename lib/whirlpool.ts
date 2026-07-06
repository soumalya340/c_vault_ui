import { AccountInfo, Connection, PublicKey } from '@solana/web3.js';
import { WHIRLPOOL_PROGRAM_ID, WSOL_MINT } from './constants';

const TICK_ARRAY_SIZE = 88;

export interface WhirlpoolInfo {
  tokenMintA: PublicKey;
  tokenVaultA: PublicKey;
  tokenMintB: PublicKey;
  tokenVaultB: PublicKey;
  tickSpacing: number;
  tickCurrentIndex: number;
  sqrtPrice: bigint;
}

export function parseWhirlpool(data: Buffer): WhirlpoolInfo {
  const sqrtLo = data.readBigUInt64LE(65);
  const sqrtHi = data.readBigUInt64LE(73);
  return {
    tokenMintA: new PublicKey(data.subarray(101, 133)),
    tokenVaultA: new PublicKey(data.subarray(133, 165)),
    tokenMintB: new PublicKey(data.subarray(181, 213)),
    tokenVaultB: new PublicKey(data.subarray(213, 245)),
    tickSpacing: data.readUInt16LE(41),
    tickCurrentIndex: data.readInt32LE(81),
    sqrtPrice: (sqrtHi << BigInt(64)) | sqrtLo,
  };
}

export function findTickArrayPda(pool: PublicKey, startIndex: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('tick_array'), pool.toBuffer(), Buffer.from(String(startIndex))],
    WHIRLPOOL_PROGRAM_ID,
  );
  return pda;
}

export function findOraclePda(pool: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('oracle'), pool.toBuffer()],
    WHIRLPOOL_PROGRAM_ID,
  );
  return pda;
}

export function deriveTickArrays(
  pool: PublicKey,
  tickCurrentIndex: number,
  tickSpacing: number,
): [PublicKey, PublicKey, PublicKey] {
  const ticksPerArray = TICK_ARRAY_SIZE * tickSpacing;
  const start0 = Math.floor(tickCurrentIndex / ticksPerArray) * ticksPerArray;
  return [
    findTickArrayPda(pool, start0),
    findTickArrayPda(pool, start0 - ticksPerArray),
    findTickArrayPda(pool, start0 + ticksPerArray),
  ];
}

export interface PoolCtx {
  address: PublicKey;
  info: WhirlpoolInfo;
  tickArrays: [PublicKey, PublicKey, PublicKey];
  oracle: PublicKey;
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

export async function fetchPoolCtx(connection: Connection, pool: PublicKey): Promise<PoolCtx> {
  const accountInfo = await fetchAccountOrThrow(connection, pool, 'Whirlpool');
  const info = parseWhirlpool(accountInfo.data);
  return {
    address: pool,
    info,
    tickArrays: deriveTickArrays(pool, info.tickCurrentIndex, info.tickSpacing),
    oracle: findOraclePda(pool),
  };
}

export function ownerAccountsFor(
  pool: PoolCtx,
  wsolAccount: PublicKey,
  otherMint: PublicKey,
  otherAccount: PublicKey,
): { ownerA: PublicKey; ownerB: PublicKey } {
  if (pool.info.tokenMintA.equals(WSOL_MINT)) {
    return { ownerA: wsolAccount, ownerB: otherAccount };
  }
  if (!pool.info.tokenMintA.equals(otherMint)) {
    throw new Error(`Pool ${pool.address.toBase58()} has unexpected mints`);
  }
  return { ownerA: otherAccount, ownerB: wsolAccount };
}
