/**
 * Manual decoder for the on-chain zero-copy `Vault` account.
 *
 * Anchor's JS coder does **not** apply rustc `repr(C)` padding for this
 * account (body is 696 bytes with padding after pubkey clusters / fee fields
 * / FundType). `program.account.vault.fetch` therefore mis-reads `num_assets`
 * and `asset_ids` (e.g. reports asset id 1 when the vault only holds id 0).
 *
 * Layout mirrors `deps/c_vault/programs/vault/src/account_state/state.rs`
 * (`#[account(zero_copy(unsafe))] #[repr(C)]`). Field offsets were verified
 * against a live devnet vault account.
 */

import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

const DISC = 8;
const MAX_ASSETS = 8;

export type FundTypeLabel = 'fixed' | 'dynamic';

export interface DecodedVault {
  vaultId: BN;
  paused: number;
  adminLocked: number;
  vaultManager: PublicKey;
  feeRecipient: PublicKey;
  sharesMint: PublicKey;
  totalShares: BN;
  totalUsdcValue: BN;
  athSharePrice: BN;
  rollingHighPrice: BN;
  rollingWindowStart: BN;
  totalDeposited: BN;
  totalWithdrawn: BN;
  depositFeeBps: number;
  redeemFeeBps: number;
  totalPendingUsdc: BN;
  totalPendingSol: BN;
  usdcTargetAmount: BN[];
  solTargetBps: number[];
  reservedAssets: BN[];
  bump: number;
  authorityBump: number;
  shareMintBump: number;
  usdcVaultBump: number;
  fundType: FundTypeLabel;
  maxShares: BN;
  numAssets: number;
  assetIds: BN[];
  assetAllocationBps: number[];
  assetAtaAddress: PublicKey[];
}

/** Absolute byte offsets into the full account (including 8-byte discriminator). */
const OFF = {
  vaultId: 8,
  paused: 16,
  adminLocked: 17,
  vaultManager: 18,
  feeRecipient: 50,
  sharesMint: 82,
  // pad 6 → align u64
  totalShares: 120,
  totalUsdcValue: 128,
  athSharePrice: 136,
  rollingHighPrice: 144,
  rollingWindowStart: 152,
  totalDeposited: 160,
  totalWithdrawn: 168,
  depositFeeBps: 176,
  redeemFeeBps: 178,
  // pad 4 → align u64
  totalPendingUsdc: 184,
  totalPendingSol: 192,
  usdcTargetAmount: 200, // [u64; 8]
  solTargetBps: 264, // [u16; 8]
  reservedAssets: 280, // [u64; 8]
  bump: 344,
  authorityBump: 345,
  shareMintBump: 346,
  usdcVaultBump: 347,
  fundType: 348,
  // pad 3 → align u64
  maxShares: 352,
  numAssets: 360,
  // pad 7 → align u64
  assetIds: 368, // [u64; 8]
  assetAllocationBps: 432, // [u16; 8]
  assetAtaAddress: 448, // [Pubkey; 8]
} as const;

const EXPECTED_LEN = DISC + 696; // 704

function u64(data: Buffer, off: number): BN {
  return new BN(data.subarray(off, off + 8), 'le');
}

function u16(data: Buffer, off: number): number {
  return data.readUInt16LE(off);
}

function pk(data: Buffer, off: number): PublicKey {
  return new PublicKey(data.subarray(off, off + 32));
}

/**
 * Decode a raw Vault account. Throws if the buffer is too short or the
 * discriminator region is missing (caller should fetch the account first).
 */
export function decodeVaultAccount(data: Buffer | Uint8Array): DecodedVault {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < EXPECTED_LEN) {
    throw new Error(
      `Vault account data too short: got ${buf.length} bytes, expected ≥ ${EXPECTED_LEN}`,
    );
  }

  const numAssets = buf[OFF.numAssets];
  if (numAssets < 1 || numAssets > MAX_ASSETS) {
    throw new Error(
      `Vault num_assets out of range: ${numAssets} (expected 1–${MAX_ASSETS}). ` +
        `Account layout may not match this decoder.`,
    );
  }

  const fundTypeRaw = buf[OFF.fundType];
  const fundType: FundTypeLabel = fundTypeRaw === 0 ? 'fixed' : 'dynamic';

  const assetIds: BN[] = [];
  const assetAllocationBps: number[] = [];
  const assetAtaAddress: PublicKey[] = [];
  for (let i = 0; i < MAX_ASSETS; i++) {
    assetIds.push(u64(buf, OFF.assetIds + i * 8));
    assetAllocationBps.push(u16(buf, OFF.assetAllocationBps + i * 2));
    assetAtaAddress.push(pk(buf, OFF.assetAtaAddress + i * 32));
  }

  const usdcTargetAmount: BN[] = [];
  const solTargetBps: number[] = [];
  const reservedAssets: BN[] = [];
  for (let i = 0; i < MAX_ASSETS; i++) {
    usdcTargetAmount.push(u64(buf, OFF.usdcTargetAmount + i * 8));
    solTargetBps.push(u16(buf, OFF.solTargetBps + i * 2));
    reservedAssets.push(u64(buf, OFF.reservedAssets + i * 8));
  }

  return {
    vaultId: u64(buf, OFF.vaultId),
    paused: buf[OFF.paused],
    adminLocked: buf[OFF.adminLocked],
    vaultManager: pk(buf, OFF.vaultManager),
    feeRecipient: pk(buf, OFF.feeRecipient),
    sharesMint: pk(buf, OFF.sharesMint),
    totalShares: u64(buf, OFF.totalShares),
    totalUsdcValue: u64(buf, OFF.totalUsdcValue),
    athSharePrice: u64(buf, OFF.athSharePrice),
    rollingHighPrice: u64(buf, OFF.rollingHighPrice),
    rollingWindowStart: u64(buf, OFF.rollingWindowStart),
    totalDeposited: u64(buf, OFF.totalDeposited),
    totalWithdrawn: u64(buf, OFF.totalWithdrawn),
    depositFeeBps: u16(buf, OFF.depositFeeBps),
    redeemFeeBps: u16(buf, OFF.redeemFeeBps),
    totalPendingUsdc: u64(buf, OFF.totalPendingUsdc),
    totalPendingSol: u64(buf, OFF.totalPendingSol),
    usdcTargetAmount,
    solTargetBps,
    reservedAssets,
    bump: buf[OFF.bump],
    authorityBump: buf[OFF.authorityBump],
    shareMintBump: buf[OFF.shareMintBump],
    usdcVaultBump: buf[OFF.usdcVaultBump],
    fundType,
    maxShares: u64(buf, OFF.maxShares),
    numAssets,
    assetIds,
    assetAllocationBps,
    assetAtaAddress,
  };
}

/** Fetch + decode a vault PDA. Returns null when the account is missing. */
export async function fetchDecodedVault(
  connection: { getAccountInfo: (pk: PublicKey) => Promise<{ data: Buffer | Uint8Array } | null> },
  vaultPda: PublicKey,
): Promise<DecodedVault | null> {
  const info = await connection.getAccountInfo(vaultPda);
  if (!info) return null;
  return decodeVaultAccount(info.data);
}
