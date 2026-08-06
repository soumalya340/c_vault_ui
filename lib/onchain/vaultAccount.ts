/**
 * Manual decoder for the on-chain zero-copy `Vault` account.
 *
 * Anchor's JS coder does **not** apply rustc `repr(C)` padding for this
 * account, so `program.account.vault.fetch` mis-reads later fields
 * (`num_assets`, `asset_ids`, …).
 *
 * Layout mirrors `deps/programs/vault/src/account_state/state.rs`
 * (`#[account(zero_copy(unsafe))] #[repr(C)]`):
 *   body size = 680, full account = 8 (disc) + 680 = 688.
 *
 * 2.0.2 layout: removed `total_usdc_value`, ATH/rolling-high marks,
 * `total_deposited`, `total_withdrawn`; added M-07 `sol_deploy_remaining_bps`
 * + `sol_deploy_done_mask`.
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
  /** `0` = not seeded, `1` = seeded (`is_genesis_done`). */
  genesisDone: number;
  /** Genesis baseline share price (PRICE_SCALE). Immutable after create_etf / genesis. */
  baselineSharePrice: BN;
  /** Shares minted by genesis_deposit; written once. */
  genesisSharesMinted: BN;
  depositFeeBps: number;
  redeemFeeBps: number;
  totalPendingUsdc: BN;
  totalPendingSol: BN;
  usdcTargetAmount: BN[];
  solTargetBps: number[];
  /** M-07: bps still owed in the current ViaSol wSOL deploy round. */
  solDeployRemainingBps: number;
  /** M-07: bitmask of slots already deployed this round. */
  solDeployDoneMask: number;
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

/**
 * Absolute byte offsets into the full account (including 8-byte discriminator).
 * Body layout: rustc `repr(C)` of `Vault` (size_of = 680).
 */
const OFF = {
  vaultId: 8,
  paused: 16,
  adminLocked: 17,
  vaultManager: 18,
  feeRecipient: 50,
  sharesMint: 82,
  // pad 6 → align u64
  totalShares: 120,
  genesisDone: 128,
  // pad 7 → align u64
  baselineSharePrice: 136,
  genesisSharesMinted: 144,
  depositFeeBps: 152,
  redeemFeeBps: 154,
  // pad 4 → align u64
  totalPendingUsdc: 160,
  totalPendingSol: 168,
  usdcTargetAmount: 176, // [u64; 8]
  solTargetBps: 240, // [u16; 8]
  solDeployRemainingBps: 256,
  solDeployDoneMask: 258,
  // pad 5 → align u64
  reservedAssets: 264, // [u64; 8]
  bump: 328,
  authorityBump: 329,
  shareMintBump: 330,
  usdcVaultBump: 331,
  fundType: 332,
  // pad 3 → align u64
  maxShares: 336,
  numAssets: 344,
  // pad 7 → align u64
  assetIds: 352, // [u64; 8]
  assetAllocationBps: 416, // [u16; 8]
  assetAtaAddress: 432, // [Pubkey; 8]
} as const;

/** Full account length: 8-byte Anchor disc + 680-byte `repr(C)` body. */
const EXPECTED_LEN = DISC + 680; // 688

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
    genesisDone: buf[OFF.genesisDone],
    baselineSharePrice: u64(buf, OFF.baselineSharePrice),
    genesisSharesMinted: u64(buf, OFF.genesisSharesMinted),
    depositFeeBps: u16(buf, OFF.depositFeeBps),
    redeemFeeBps: u16(buf, OFF.redeemFeeBps),
    totalPendingUsdc: u64(buf, OFF.totalPendingUsdc),
    totalPendingSol: u64(buf, OFF.totalPendingSol),
    usdcTargetAmount,
    solTargetBps,
    solDeployRemainingBps: u16(buf, OFF.solDeployRemainingBps),
    solDeployDoneMask: buf[OFF.solDeployDoneMask],
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
