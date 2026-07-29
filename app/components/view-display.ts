/**
 * Human-readable display shaping for VIEW-tab outputs.
 *
 * On-chain view/preview helpers still return raw base units (for deposit/redeem
 * modals and db-sync). The VIEW accordion only needs certificate-style numbers
 * inspired by `cVault Console.dc.html` — no raw integers in the OUTPUT panel.
 */

import { formatUnits } from '@/lib/cvault';
import {
  PRICE_SCALE_DECIMALS,
  USDC_DECIMALS,
  WSOL_DECIMALS,
} from '@/lib/constants';

/** Insert thousands separators into a decimal string from `formatUnits`. */
export function withCommas(ui: string): string {
  if (!ui || ui === '—' || ui === '--') return ui;
  const neg = ui.startsWith('-');
  const body = neg ? ui.slice(1) : ui;
  const [whole, frac] = body.split('.');
  const wholeFmt = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const out = frac !== undefined && frac.length > 0 ? `${wholeFmt}.${frac}` : wholeFmt;
  return neg ? `-${out}` : out;
}

export function formatTokenUi(raw: string | number | bigint, decimals: number): string {
  return withCommas(formatUnits(String(raw), decimals));
}

export function formatUsdUi(raw: string | number | bigint, decimals: number = USDC_DECIMALS): string {
  return `$${formatTokenUi(raw, decimals)}`;
}

export function formatBpsAsPercent(bps: number): string {
  // 100 bps = 1.00%
  const pct = (bps / 100).toFixed(2);
  return `${pct}% (${bps} bps)`;
}

function shortPubkey(pk: string): string {
  if (pk.length <= 12) return pk;
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

function formatAllocationBps(bps: number[]): string {
  if (bps.length === 0) return '—';
  return bps.map((b) => `${(b / 100).toFixed(2)}%`).join(' · ');
}

/**
 * Map a VIEW function result into display-only fields. Unknown ids pass through.
 * Order of keys matches the console design (hero metrics first).
 */
export function humanizeViewResult(fnId: string, data: unknown): unknown {
  if (data == null || typeof data !== 'object') return data;

  switch (fnId) {
    case 'view_nav':
      return humanizeNav(data as Record<string, unknown>);
    case 'view_vault_state':
      return humanizeVaultState(data as Record<string, unknown>);
    case 'view_my_position':
      return humanizeUserPosition(data as Record<string, unknown>);
    case 'view_asset_state':
      return humanizeAssetState(data as Record<string, unknown>);
    case 'view_vault_asset_balances':
      // Already shaped as { asset, balance } with ui amounts in execute path.
      return data;
    default:
      return data;
  }
}

function humanizeNav(d: Record<string, unknown>): Record<string, unknown> {
  // Prefer pre-formatted human fields from getTotalNavView; never surface raw.
  // On-chain field is `tvl` (renamed from total_nav) — display label is TVL.
  const tvl =
    typeof d.totalNavUsd === 'string'
      ? enhanceUsdString(d.totalNavUsd)
      : d.tvl != null
        ? formatUsdUi(String(d.tvl), USDC_DECIMALS)
        : d.totalNav != null
          ? formatUsdUi(String(d.totalNav), USDC_DECIMALS)
          : '—';
  const sharePrice =
    typeof d.sharePriceUsd === 'string'
      ? enhanceUsdString(d.sharePriceUsd)
      : d.sharePrice != null && String(d.sharePrice) !== '0'
        ? formatUsdUi(String(d.sharePrice), PRICE_SCALE_DECIMALS)
        : '—';
  const totalShares =
    typeof d.totalSharesUi === 'string'
      ? withCommas(d.totalSharesUi)
      : d.totalShares != null
        ? formatTokenUi(String(d.totalShares), Number(d.sharesDecimals ?? 6))
        : '—';

  const out: Record<string, unknown> = {
    tvl,
    sharePrice,
    totalShares,
  };
  if (typeof d.note === 'string' && d.note) out.note = d.note;
  return out;
}

/** `$12.3` → `$12.3` with commas on the integer part; leave `—` alone. */
function enhanceUsdString(s: string): string {
  if (s === '—' || s === '--' || s === '') return s;
  if (s.startsWith('$')) return `$${withCommas(s.slice(1))}`;
  return withCommas(s);
}

function humanizeVaultState(d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    vaultId: d.vaultId,
    totalShares: formatTokenUi(String(d.totalShares ?? '0'), 6),
    totalUsdcValue: formatUsdUi(String(d.totalUsdcValue ?? '0'), USDC_DECIMALS),
    totalPendingUsdc: formatUsdUi(String(d.totalPendingUsdc ?? '0'), USDC_DECIMALS),
    totalPendingSol: `${formatTokenUi(String(d.totalPendingSol ?? '0'), WSOL_DECIMALS)} SOL`,
    sharePriceAth: formatUsdUi(String(d.athSharePrice ?? '0'), PRICE_SCALE_DECIMALS),
    depositFee: formatBpsAsPercent(Number(d.depositFeeBps ?? 0)),
    redeemFee: formatBpsAsPercent(Number(d.redeemFeeBps ?? 0)),
    numAssets: d.numAssets,
    assetIds: Array.isArray(d.assetIds) ? (d.assetIds as number[]).join(', ') : d.assetIds,
    allocation: Array.isArray(d.assetAllocationBps)
      ? formatAllocationBps(d.assetAllocationBps as number[])
      : d.assetAllocationBps,
    paused: d.paused,
    adminLocked: d.adminLocked,
    genesisDone: d.genesisDone,
    feeRecipient: typeof d.feeRecipient === 'string' ? shortPubkey(d.feeRecipient) : d.feeRecipient,
    address: typeof d.address === 'string' ? shortPubkey(d.address) : d.address,
    baseMint: typeof d.baseMint === 'string' ? shortPubkey(d.baseMint) : d.baseMint,
  };
  if (d.usdcSolPool && typeof d.usdcSolPool === 'string') {
    out.usdcSolPool = shortPubkey(d.usdcSolPool);
  }
  return out;
}

function humanizeUserPosition(d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    user: typeof d.user === 'string' ? shortPubkey(d.user) : d.user,
    shareBalance: formatTokenUi(String(d.shareBalance ?? '0'), 6),
  };

  const redeem = d.redeemState as Record<string, unknown> | undefined;
  if (redeem) {
    out.isRedeemActive = Boolean(redeem.isRedeemActive);
    out.pendingUsdc = formatUsdUi(String(redeem.pendingUsdc ?? '0'), USDC_DECIMALS);
    out.redeemAssets = redeem.numAssets;
  }

  return out;
}

function humanizeAssetState(d: Record<string, unknown>): Record<string, unknown> {
  const priceSource =
    Number(d.priceSourceTag) === 0 ? 'Pyth' : Number(d.priceSourceTag) === 1 ? 'DEX' : String(d.priceSourceTag);
  const tokenProgram =
    Number(d.tokenProgramTag) === 0
      ? 'SPL Token'
      : Number(d.tokenProgramTag) === 1
        ? 'Token-2022'
        : String(d.tokenProgramTag);
  const out: Record<string, unknown> = {
    assetId: d.assetId,
    name: typeof d.assetName === 'string' && d.assetName ? d.assetName : '—',
    mint: typeof d.mint === 'string' ? shortPubkey(d.mint) : d.mint,
    decimals: d.decimals,
    route: d.route,
    priceSource,
    swapKind: d.swapKind,
    tokenProgram,
    active: d.active,
    pool: typeof d.poolAddress === 'string' ? shortPubkey(d.poolAddress) : d.poolAddress,
  };
  if (d.pricePoolAddress && typeof d.pricePoolAddress === 'string' && d.pricePoolAddress !== '11111111111111111111111111111111') {
    out.pricePool = shortPubkey(d.pricePoolAddress);
  }
  return out;
}
