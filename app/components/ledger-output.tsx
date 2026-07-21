'use client';

/**
 * Renders an OUTPUT payload as engraved ledger line items inspired by
 * `cVault Console.dc.html` — human-readable certificate rows, never raw JSON.
 *
 * VIEW results are pre-shaped by `humanizeViewResult` / execute path so values
 * already carry `$`, units, and commas. This component only labels, orders,
 * and styles them.
 */

/** camelCase / snake_case key → certificate-register label. */
const LABEL_OVERRIDES: Record<string, string> = {
  totalNav: 'Total NAV',
  totalNavUsd: 'Total NAV',
  sharePrice: 'Share price',
  sharePriceUsd: 'Share price',
  sharePriceAth: 'ATH share price',
  totalShares: 'Shares outstanding',
  totalSharesUi: 'Shares outstanding',
  sharesToMint: 'Shares to mint',
  sharesDecimals: 'Share decimals',
  totalUsdcValue: 'Portfolio value',
  totalPendingUsdc: 'Pending USDC',
  totalPendingSol: 'Pending SOL',
  estimatedUsdcValue: 'Estimated USDC',
  numAssets: 'Assets in basket',
  assetsToSwap: 'Assets to swap',
  perAssetAmounts: 'Per-asset amounts',
  shareBalance: 'Share balance',
  isRedeemActive: 'Redeem active',
  pendingUsdc: 'Pending USDC',
  vaultId: 'Vault ID',
  assetId: 'Asset ID',
  wsolAssetId: 'wSOL asset ID',
  altAddress: 'Address Lookup Table',
  altCreated: 'ALT newly created',
  solscan: 'Solscan',
  tx: 'Transaction',
  note: 'Note',
  registryWarning: 'Registry warning',
  paused: 'Paused',
  adminLocked: 'Admin locked',
  emergency: 'Emergency',
  isEmergency: 'Emergency',
  active: 'Active',
  mint: 'Mint',
  asset: 'Asset',
  balance: 'Balance',
  depositFee: 'Deposit fee',
  redeemFee: 'Redeem fee',
  feeRecipient: 'Fee recipient',
  address: 'Vault address',
  baseMint: 'Quote mint',
  treasury: 'Treasury',
  twapKeeper: 'TWAP keeper',
  totalVaults: 'Total vaults',
  totalAssets: 'Total assets',
  redeemAssets: 'Redeem assets',
  allocation: 'Allocation',
  assetIds: 'Asset IDs',
  priceSource: 'Price source',
  swapKind: 'Swap venue',
  tokenProgram: 'Token program',
  pool: 'Swap pool',
  pricePool: 'Price pool',
  route: 'Route',
  decimals: 'Decimals',
  user: 'Wallet',
  usdcSolPool: 'USDC/SOL pool',
};

/**
 * Keys that are raw on-chain base units — never render when a human twin may
 * already be present, and never as a standalone row either.
 */
const RAW_KEYS_HIDDEN = new Set([
  'athSharePrice',
  'assetAmounts',
  'assetAllocationBps',
  'depositFeeBps',
  'redeemFeeBps',
  'pythFeedId',
  'priceSourceTag',
  'priceDexKind',
  'tokenProgramTag',
  'pricePoolAddress',
  'poolAddress',
  'treasuryAddr',
  'assetAmountIn',
  'assetSwapped',
  'assetToSolDone',
]);

/** Hero metrics get larger accent styling (console OUTPUT panel). */
const EMPHASIS_KEYS = new Set([
  'totalNav',
  'totalNavUsd',
  'sharePrice',
  'sharePriceUsd',
  'totalShares',
  'totalSharesUi',
  'sharesToMint',
  'estimatedUsdcValue',
  'totalUsdcValue',
  'shareBalance',
]);

/** Preferred row order for NAV / preview style payloads. */
const KEY_ORDER = [
  'totalNav',
  'totalNavUsd',
  'sharePrice',
  'sharePriceUsd',
  'totalShares',
  'totalSharesUi',
  'sharesToMint',
  'estimatedUsdcValue',
  'assetsToSwap',
  'numAssets',
  'perAssetAmounts',
  'sharesDecimals',
  'shareBalance',
  'totalUsdcValue',
  'totalPendingUsdc',
  'totalPendingSol',
  'sharePriceAth',
  'depositFee',
  'redeemFee',
  'note',
];

function titleCaseKey(key: string): string {
  const spaced = key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function labelFor(key: string): string {
  return LABEL_OVERRIDES[key] ?? titleCaseKey(key);
}

/** true/false → Yes/No; never dump booleans as raw JSON. */
function formatPrimitive(key: string, value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number' && !Number.isFinite(value)) return '—';
  // Already-humanized view strings keep their `$` / commas / units as-is.
  return String(value);
}

type Row = { key: string; label: string; value: unknown; depth: number; emphasis: boolean };

function sortEntries(entries: [string, unknown][]): [string, unknown][] {
  const rank = (k: string) => {
    const i = KEY_ORDER.indexOf(k);
    return i === -1 ? 1000 + k.charCodeAt(0) : i;
  };
  return [...entries].sort((a, b) => rank(a[0]) - rank(b[0]));
}

/** Flattens a parsed JSON object into display rows, indenting nested objects. */
function flatten(obj: Record<string, unknown>, depth = 0): Row[] {
  const rows: Row[] = [];
  for (const [key, value] of sortEntries(Object.entries(obj))) {
    if (value === undefined) continue;
    if (key === 'solscan') continue; // dedicated link row in parent
    // Hide leftover raw fields if a humanize path missed them.
    if (RAW_KEYS_HIDDEN.has(key)) continue;
    // Never show a key whose label still says "(raw)".
    if (/\(raw\)/i.test(labelFor(key))) continue;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      rows.push({
        key,
        label: labelFor(key),
        value: undefined,
        depth,
        emphasis: false,
      });
      rows.push(...flatten(value as Record<string, unknown>, depth + 1));
      continue;
    }
    if (Array.isArray(value)) {
      rows.push({
        key,
        label: labelFor(key),
        value: value.every((v) => typeof v !== 'object')
          ? value.join(', ')
          : value
              .map((v, i) =>
                v && typeof v === 'object'
                  ? Object.entries(v as Record<string, unknown>)
                      .map(([k, val]) => `${labelFor(k)} ${formatPrimitive(k, val)}`)
                      .join(' · ')
                  : String(v),
              )
              .filter(Boolean)
              .join(' | ') || '—',
        depth,
        emphasis: EMPHASIS_KEYS.has(key),
      });
      continue;
    }
    rows.push({
      key,
      label: labelFor(key),
      value,
      depth,
      emphasis: depth === 0 && EMPHASIS_KEYS.has(key),
    });
  }
  return rows;
}

export function LedgerOutput({ text, tone }: { text: string; tone: 'success' | 'error' | 'info' }) {
  const toneClass =
    tone === 'error' ? 'text-destructive' : tone === 'success' ? 'text-foreground' : 'text-muted-foreground';

  let parsed: Record<string, unknown> | null = null;
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const candidate = JSON.parse(trimmed);
      if (Array.isArray(candidate)) {
        // Array of objects → index as rows; array of primitives → single line.
        if (candidate.length === 0) {
          parsed = { note: 'No data.' };
        } else if (candidate.every((v) => v !== null && typeof v === 'object' && !Array.isArray(v))) {
          parsed = Object.fromEntries(
            (candidate as Record<string, unknown>[]).map((row, i) => {
              const label =
                (typeof row.asset === 'string' && row.asset) ||
                (typeof row.name === 'string' && row.name) ||
                `Item ${i + 1}`;
              const rest = { ...row };
              delete rest.asset;
              delete rest.name;
              const vals = Object.values(rest);
              return [label, vals.length === 1 ? vals[0] : rest];
            }),
          );
        } else {
          parsed = { value: candidate.join(', ') };
        }
      } else if (candidate !== null && typeof candidate === 'object') {
        parsed = candidate as Record<string, unknown>;
      }
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    return (
      <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${toneClass}`}>
        {text}
      </p>
    );
  }

  const rows = flatten(parsed).filter((r) => r.value !== undefined || r.depth === 0);

  // Drop section headers that have no children with values (orphan labels).
  const visible = rows.filter((r, i) => {
    if (r.value !== undefined) return true;
    // Keep header only if a deeper row follows before next same-depth row.
    for (let j = i + 1; j < rows.length; j += 1) {
      if (rows[j].depth <= r.depth) return false;
      if (rows[j].value !== undefined) return true;
    }
    return false;
  });

  if (visible.length === 0) {
    return (
      <p className={`text-sm leading-relaxed ${toneClass}`}>
        Confirmed — no return data.
      </p>
    );
  }

  return (
    <dl className="divide-y divide-border/80">
      {visible.map((row, i) => {
        const isHeader = row.value === undefined;
        const isLast = i === visible.length - 1;
        return (
          <div
            key={`${row.key}-${i}`}
            className={`flex items-center justify-between gap-4 ${
              isHeader ? 'pb-1 pt-3 first:pt-0' : 'py-3 first:pt-1 last:pb-1'
            }`}
            style={row.depth > 0 ? { paddingLeft: `${row.depth * 0.85}rem` } : undefined}
          >
            <dt
              className={`font-mono uppercase tracking-[0.16em] ${
                isHeader
                  ? 'text-[10px] font-medium text-muted-foreground/80'
                  : row.depth > 0
                    ? 'text-[10px] text-muted-foreground/70'
                    : 'text-[10px] tracking-[0.18em] text-muted-foreground'
              }`}
            >
              {row.depth > 0 && !isHeader && (
                <span className="mr-1.5 text-muted-foreground/40">&#8212;</span>
              )}
              {row.label}
            </dt>
            {isHeader ? null : (
              <dd
                className={`min-w-0 max-w-[65%] truncate text-right font-mono tabular-nums ${
                  row.emphasis
                    ? 'text-[15px] font-bold text-accent'
                    : `text-[13px] font-semibold ${toneClass}`
                } ${isLast ? '' : ''}`}
                title={formatPrimitive(row.key, row.value)}
              >
                {formatPrimitive(row.key, row.value)}
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}
