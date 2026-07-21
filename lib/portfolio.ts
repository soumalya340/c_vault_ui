/**
 * Wallet portfolio: which cVault ETF share certificates a pubkey holds, and
 * how much. Reads are RPC-only (no program .view() / simulateTransaction) so
 * the page stays light on quota — share balances from Token-2022 ATAs, an
 * optional RedeemState PDA, and book value from the vault account.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import type { Network } from '@/lib/constants';
import { USDC_DECIMALS } from '@/lib/constants';
import { deriveRedeemStatePda, deriveVaultPdas } from '@/lib/pda';
import { decodeVaultAccount } from '@/lib/vaultAccount';
import type { VaultRecord } from '@/lib/registryClient';

/** SPL Token / Token-2022 account: amount is u64 LE at offset 64. */
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64;

export interface PortfolioHolding {
  vault: VaultRecord;
  /** Raw Token-2022 share balance (base units). */
  shareBalance: string;
  /** Shares mint decimals — matches USDC (6) per create_etf. */
  sharesDecimals: number;
  /**
   * Pro-rata book value in USDC base units:
   * floor(shareBalance × vault.totalUsdcValue / vault.totalShares).
   * Null when the vault has zero share supply or zero book value.
   * Book value is on-chain accounting, not a live oracle NAV.
   */
  estimatedUsdc: string | null;
  vaultTotalShares: string;
  vaultTotalUsdcValue: string;
  /** Ownership of outstanding shares in bps (0–10_000); null if total is 0. */
  ownershipBps: number | null;
  isRedeemActive: boolean;
  redeemPendingUsdc: string | null;
}

export interface PortfolioSnapshot {
  holdings: PortfolioHolding[];
  positionCount: number;
  /** Sum of estimated USDC book values (base units); ignores null estimates. */
  totalEstimatedUsdc: string;
  /** Positions with pending redeem USDC > 0. */
  pendingRedeemCount: number;
}

/** Solana `getMultipleAccounts` hard-caps around 100 keys per call. */
const MULTI_GET_CHUNK = 100;

function asBuffer(data: Buffer | Uint8Array | undefined | null): Buffer | null {
  if (!data) return null;
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

async function getMultipleAccountsChunked(
  connection: Connection,
  keys: PublicKey[],
): Promise<(Awaited<ReturnType<Connection['getAccountInfo']>>)[]> {
  if (keys.length === 0) return [];
  const out: (Awaited<ReturnType<Connection['getAccountInfo']>>)[] = [];
  for (let i = 0; i < keys.length; i += MULTI_GET_CHUNK) {
    const chunk = keys.slice(i, i + MULTI_GET_CHUNK);
    const infos = await connection.getMultipleAccountsInfo(chunk);
    out.push(...infos);
  }
  return out;
}

function readU64Le(data: Buffer, offset: number): bigint {
  if (data.length < offset + 8) return 0n;
  return data.readBigUInt64LE(offset);
}

function amountFromTokenAccount(data: Buffer | null): bigint {
  if (!data || data.length < TOKEN_ACCOUNT_AMOUNT_OFFSET + 8) return 0n;
  return readU64Le(data, TOKEN_ACCOUNT_AMOUNT_OFFSET);
}

/**
 * RedeemState after 8-byte disc (Borsh):
 *   is_redeem_active: bool (1 byte, offset 8)
 *   pending_usdc: u64 (offset 9)
 * Only these two fields are needed for the portfolio summary.
 */
function parseRedeemHead(data: Buffer | null): {
  isRedeemActive: boolean;
  pendingUsdc: bigint;
} | null {
  if (!data || data.length < 9 + 8) return null;
  const isRedeemActive = data.readUInt8(8) !== 0;
  const pendingUsdc = readU64Le(data, 9);
  if (!isRedeemActive && pendingUsdc === 0n) return null;
  return { isRedeemActive, pendingUsdc };
}

function proRataUsdc(
  shareBalance: bigint,
  totalShares: bigint,
  totalUsdcValue: bigint,
): string | null {
  if (shareBalance <= 0n || totalShares <= 0n || totalUsdcValue <= 0n) return null;
  return ((shareBalance * totalUsdcValue) / totalShares).toString();
}

function ownershipBps(shareBalance: bigint, totalShares: bigint): number | null {
  if (shareBalance <= 0n || totalShares <= 0n) return null;
  const bps = Number((shareBalance * 10_000n) / totalShares);
  return Number.isFinite(bps) ? Math.min(bps, 10_000) : null;
}

/**
 * Load the connected wallet's portfolio for every vault in the registry.
 *
 * RPC plan (bounded, no per-row simulateTransaction):
 *  1. getMultipleAccountsInfo — user share ATAs (Token-2022)
 *  2. getMultipleAccountsInfo — redeem-state PDAs (pending claims with 0 shares)
 *  3. For rows that still look active: vault accounts (batched)
 */
export async function fetchWalletPortfolio(
  connection: Connection,
  user: PublicKey,
  vaults: VaultRecord[],
  network: Network,
): Promise<PortfolioSnapshot> {
  if (vaults.length === 0) {
    return {
      holdings: [],
      positionCount: 0,
      totalEstimatedUsdc: '0',
      pendingRedeemCount: 0,
    };
  }

  const shareAtas = vaults.map((v) => {
    const mint = new PublicKey(v.shares_mint);
    return getAssociatedTokenAddressSync(mint, user, false, TOKEN_2022_PROGRAM_ID);
  });
  const redeemPdas = vaults.map((v) => deriveRedeemStatePda(user, v.vault_id));

  const [ataInfos, redeemInfos] = await Promise.all([
    getMultipleAccountsChunked(connection, shareAtas),
    getMultipleAccountsChunked(connection, redeemPdas),
  ]);

  type Candidate = {
    vault: VaultRecord;
    shareBalance: bigint;
    redeem: ReturnType<typeof parseRedeemHead>;
  };

  const candidates: Candidate[] = [];
  for (let i = 0; i < vaults.length; i++) {
    const shareBalance = amountFromTokenAccount(asBuffer(ataInfos[i]?.data));
    const redeem = parseRedeemHead(asBuffer(redeemInfos[i]?.data));
    if (shareBalance > 0n || redeem != null) {
      candidates.push({
        vault: vaults[i]!,
        shareBalance,
        redeem,
      });
    }
  }

  if (candidates.length === 0) {
    return {
      holdings: [],
      positionCount: 0,
      totalEstimatedUsdc: '0',
      pendingRedeemCount: 0,
    };
  }

  const vaultPdas = candidates.map((c) =>
    deriveVaultPdas(c.vault.vault_id, network).vaultPda,
  );
  const vaultInfos = await getMultipleAccountsChunked(connection, vaultPdas);

  const holdings: PortfolioHolding[] = [];
  let totalEstimated = 0n;
  let pendingRedeemCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    let totalShares = 0n;
    let totalUsdcValue = 0n;

    const vaultBuf = asBuffer(vaultInfos[i]?.data);
    if (vaultBuf) {
      try {
        const vault = decodeVaultAccount(vaultBuf);
        totalShares = BigInt(vault.totalShares.toString());
        totalUsdcValue = BigInt(vault.totalUsdcValue.toString());
      } catch {
        // Full layout validation can fail on edge accounts; the two u64s we
        // need sit at fixed offsets (see lib/vaultAccount.ts OFF).
        if (vaultBuf.length >= 136) {
          totalShares = readU64Le(vaultBuf, 120);
          totalUsdcValue = readU64Le(vaultBuf, 128);
        }
      }
    }

    const estimatedUsdc = proRataUsdc(c.shareBalance, totalShares, totalUsdcValue);
    if (estimatedUsdc) totalEstimated += BigInt(estimatedUsdc);

    const redeemPending = c.redeem?.pendingUsdc ?? null;
    if (redeemPending != null && redeemPending > 0n) pendingRedeemCount += 1;

    holdings.push({
      vault: c.vault,
      shareBalance: c.shareBalance.toString(),
      sharesDecimals: USDC_DECIMALS,
      estimatedUsdc,
      vaultTotalShares: totalShares.toString(),
      vaultTotalUsdcValue: totalUsdcValue.toString(),
      ownershipBps: ownershipBps(c.shareBalance, totalShares),
      isRedeemActive: c.redeem?.isRedeemActive ?? false,
      redeemPendingUsdc: redeemPending != null ? redeemPending.toString() : null,
    });
  }

  holdings.sort((a, b) => {
    const ea = BigInt(a.estimatedUsdc ?? '0');
    const eb = BigInt(b.estimatedUsdc ?? '0');
    if (eb !== ea) return eb > ea ? 1 : -1;
    const sa = BigInt(a.shareBalance);
    const sb = BigInt(b.shareBalance);
    if (sb !== sa) return sb > sa ? 1 : -1;
    return a.vault.vault_id - b.vault.vault_id;
  });

  return {
    holdings,
    positionCount: holdings.length,
    totalEstimatedUsdc: totalEstimated.toString(),
    pendingRedeemCount,
  };
}
