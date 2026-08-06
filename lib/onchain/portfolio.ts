/**
 * Wallet portfolio: which cVault ETF share certificates a pubkey holds, and
 * how much. Reads are RPC-only (no program .view() / simulateTransaction) so
 * the page stays light on quota — share balances from Token-2022 ATAs, an
 * optional RedeemState PDA + redeem_usdc escrow, and share supply from the
 * vault account.
 *
 * Book value is **not** computed from the vault account anymore — the on-chain
 * `total_usdc_value` counter was removed (Audit L-01). Estimated USDC is left
 * null unless a future off-chain NAV cache is wired in.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import type { Network } from "@/lib/constants";
import { USDC_DECIMALS } from "@/lib/constants";
import {
  deriveRedeemStatePda,
  deriveRedeemUsdcPda,
  deriveVaultPdas,
} from "@/lib/onchain/pda";
import { decodeVaultAccount } from "@/lib/onchain/vaultAccount";
import type { VaultRecord } from "@/lib/registryClient";

/** SPL Token / Token-2022 account: amount is u64 LE at offset 64. */
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64;

export interface PortfolioHolding {
  vault: VaultRecord;
  /** Raw Token-2022 share balance (base units). */
  shareBalance: string;
  /** Shares mint decimals — matches USDC (6) per create_etf. */
  sharesDecimals: number;
  /**
   * Pro-rata book value is no longer available from the vault account
   * (`total_usdc_value` removed). Always null for the lightweight portfolio
   * path — use live NAV views when a dollar figure is required.
   */
  estimatedUsdc: string | null;
  vaultTotalShares: string;
  /** @deprecated Always "0" — field retained for UI compatibility. */
  vaultTotalUsdcValue: string;
  /** Ownership of outstanding shares in bps (0–10_000); null if total is 0. */
  ownershipBps: number | null;
  isRedeemActive: boolean;
  /** USDC base units in the per-redeem escrow (`redeem_usdc`). */
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
): Promise<Awaited<ReturnType<Connection["getAccountInfo"]>>[]> {
  if (keys.length === 0) return [];
  const out: Awaited<ReturnType<Connection["getAccountInfo"]>>[] = [];
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
 *   is_redeem_active: bool (offset 8)
 * Pending USDC is **not** on this account — it lives on `redeem_usdc`.
 */
function parseRedeemActive(data: Buffer | null): boolean {
  if (!data || data.length < 9) return false;
  return data.readUInt8(8) !== 0;
}

function ownershipBps(
  shareBalance: bigint,
  totalShares: bigint,
): number | null {
  if (shareBalance <= 0n || totalShares <= 0n) return null;
  const bps = Number((shareBalance * 10_000n) / totalShares);
  return Number.isFinite(bps) ? Math.min(bps, 10_000) : null;
}

/**
 * Load the connected wallet's portfolio for every vault in the registry.
 *
 * RPC plan (bounded, no per-row simulateTransaction):
 *  1. getMultipleAccountsInfo — user share ATAs (Token-2022)
 *  2. getMultipleAccountsInfo — redeem-state PDAs
 *  3. getMultipleAccountsInfo — redeem_usdc escrow token accounts
 *  4. For rows that still look active: vault accounts (batched)
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
      totalEstimatedUsdc: "0",
      pendingRedeemCount: 0,
    };
  }

  const shareAtas = vaults.map((v) => {
    const mint = new PublicKey(v.shares_mint);
    return getAssociatedTokenAddressSync(
      mint,
      user,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
  });
  const redeemPdas = vaults.map((v) => deriveRedeemStatePda(user, v.vault_id));
  const redeemUsdcPdas = vaults.map((v) =>
    deriveRedeemUsdcPda(user, v.vault_id),
  );

  const [ataInfos, redeemInfos, redeemUsdcInfos] = await Promise.all([
    getMultipleAccountsChunked(connection, shareAtas),
    getMultipleAccountsChunked(connection, redeemPdas),
    getMultipleAccountsChunked(connection, redeemUsdcPdas),
  ]);

  type Candidate = {
    vault: VaultRecord;
    shareBalance: bigint;
    isRedeemActive: boolean;
    redeemPendingUsdc: bigint;
  };

  const candidates: Candidate[] = [];
  for (let i = 0; i < vaults.length; i++) {
    const shareBalance = amountFromTokenAccount(asBuffer(ataInfos[i]?.data));
    const isRedeemActive = parseRedeemActive(asBuffer(redeemInfos[i]?.data));
    const redeemPendingUsdc = amountFromTokenAccount(
      asBuffer(redeemUsdcInfos[i]?.data),
    );
    if (shareBalance > 0n || isRedeemActive || redeemPendingUsdc > 0n) {
      candidates.push({
        vault: vaults[i]!,
        shareBalance,
        isRedeemActive,
        redeemPendingUsdc,
      });
    }
  }

  if (candidates.length === 0) {
    return {
      holdings: [],
      positionCount: 0,
      totalEstimatedUsdc: "0",
      pendingRedeemCount: 0,
    };
  }

  const vaultPdas = candidates.map(
    (c) => deriveVaultPdas(c.vault.vault_id, network).vaultPda,
  );
  const vaultInfos = await getMultipleAccountsChunked(connection, vaultPdas);

  const holdings: PortfolioHolding[] = [];
  let pendingRedeemCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    let totalShares = 0n;

    const vaultBuf = asBuffer(vaultInfos[i]?.data);
    if (vaultBuf) {
      try {
        const vault = decodeVaultAccount(vaultBuf);
        totalShares = BigInt(vault.totalShares.toString());
      } catch {
        // Full layout validation can fail on edge accounts; total_shares sits
        // at fixed offset 120 (see lib/vaultAccount.ts OFF).
        if (vaultBuf.length >= 128) {
          totalShares = readU64Le(vaultBuf, 120);
        }
      }
    }

    if (c.redeemPendingUsdc > 0n) pendingRedeemCount += 1;

    holdings.push({
      vault: c.vault,
      shareBalance: c.shareBalance.toString(),
      sharesDecimals: USDC_DECIMALS,
      estimatedUsdc: null,
      vaultTotalShares: totalShares.toString(),
      vaultTotalUsdcValue: "0",
      ownershipBps: ownershipBps(c.shareBalance, totalShares),
      isRedeemActive: c.isRedeemActive,
      redeemPendingUsdc:
        c.redeemPendingUsdc > 0n || c.isRedeemActive
          ? c.redeemPendingUsdc.toString()
          : null,
    });
  }

  holdings.sort((a, b) => {
    const sa = BigInt(a.shareBalance);
    const sb = BigInt(b.shareBalance);
    if (sb !== sa) return sb > sa ? 1 : -1;
    return a.vault.vault_id - b.vault.vault_id;
  });

  return {
    holdings,
    positionCount: holdings.length,
    totalEstimatedUsdc: "0",
    pendingRedeemCount,
  };
}
