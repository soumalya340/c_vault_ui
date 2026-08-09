'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { Network } from '@/lib/onchain/cvault';
import { fetchVaults, type VaultRecord } from '@/lib/registryClient';
import { vaultDetailPath } from './console-routes';
import { VaultListSkeleton } from './loading-skeletons';

const ASSET_COLORS = [
  '#C8FF3D',
  '#5AC8E8',
  '#B78CFF',
  '#FF9E4D',
  '#FF6B4D',
  '#7DE8A8',
] as const;

type FeeFilter = 'all' | 'under50' | '50to100' | 'over100';
type SizeFilter = 'all' | 'over1m' | 'new';
type SortKey = 'tvl' | 'new';

function formatFeeBps(bps: number): string {
  const n = Number(bps);
  if (!Number.isFinite(n)) return '—';
  return `${(n / 100).toFixed(2)}%`;
}

function parseUsd(raw: string | null | undefined): number {
  const n = Number(String(raw ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function formatTvl(raw: string | null | undefined): string {
  const n = parseUsd(raw);
  if (n <= 0) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function displayName(name: string): string {
  const t = name.trim();
  if (!t) return 'Untitled vault';
  return t.replace(/\s+/g, ' ');
}

function dotsForVault(vaultId: number, numAssets: number) {
  const count = Math.max(1, Math.min(numAssets || 3, 3));
  return Array.from({ length: count }, (_, i) => {
    const idx = (vaultId + i * 2) % ASSET_COLORS.length;
    return ASSET_COLORS[idx];
  });
}

export function VaultsPanel({ network }: { network: Network }) {
  const [vaults, setVaults] = useState<VaultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feeFilter, setFeeFilter] = useState<FeeFilter>('all');
  const [sizeFilter, setSizeFilter] = useState<SizeFilter>('all');
  const [sort, setSort] = useState<SortKey>('tvl');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchVaults(network);
      // Hide vaults that have not completed genesis deposit — not investable yet.
      setVaults(rows.filter((v) => Boolean(v.genesis_deposit_status)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let rows = [...vaults];

    if (feeFilter === 'under50') {
      rows = rows.filter((v) => v.deposit_fee_bps < 50);
    } else if (feeFilter === '50to100') {
      rows = rows.filter(
        (v) => v.deposit_fee_bps >= 50 && v.deposit_fee_bps <= 100,
      );
    } else if (feeFilter === 'over100') {
      rows = rows.filter((v) => v.deposit_fee_bps > 100);
    }

    if (sizeFilter === 'over1m') {
      rows = rows.filter((v) => parseUsd(v.total_usdc_value) >= 1_000_000);
    } else if (sizeFilter === 'new') {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      rows = rows.filter((v) => {
        if (!v.created_at) return false;
        const t = Date.parse(v.created_at);
        return Number.isFinite(t) && t >= weekAgo;
      });
    }

    if (sort === 'tvl') {
      rows.sort(
        (a, b) => parseUsd(b.total_usdc_value) - parseUsd(a.total_usdc_value),
      );
    } else {
      rows.sort((a, b) => {
        const ta = a.created_at ? Date.parse(a.created_at) : 0;
        const tb = b.created_at ? Date.parse(b.created_at) : 0;
        return tb - ta;
      });
    }

    return rows;
  }, [vaults, feeFilter, sizeFilter, sort]);

  const feeCounts = useMemo(() => {
    return {
      under50: vaults.filter((v) => v.deposit_fee_bps < 50).length,
      mid: vaults.filter(
        (v) => v.deposit_fee_bps >= 50 && v.deposit_fee_bps <= 100,
      ).length,
      over: vaults.filter((v) => v.deposit_fee_bps > 100).length,
    };
  }, [vaults]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid flex-1 grid-cols-1 md:grid-cols-[212px_1fr]">
        {/* Sidebar filters */}
        <aside className="flex flex-col gap-[26px] border-b border-border px-5 py-6 md:border-b-0 md:border-r md:px-5">
          <FilterGroup label="CATEGORY">
            <FilterItem
              active={feeFilter === 'all' && sizeFilter === 'all'}
              onClick={() => {
                setFeeFilter('all');
                setSizeFilter('all');
              }}
              label="All vaults"
              count={vaults.length}
            />
          </FilterGroup>

          <FilterGroup label="ENTRY FEE">
            <FilterItem
              active={feeFilter === 'under50'}
              onClick={() => setFeeFilter((f) => (f === 'under50' ? 'all' : 'under50'))}
              label="Under 0.50%"
              count={feeCounts.under50}
            />
            <FilterItem
              active={feeFilter === '50to100'}
              onClick={() =>
                setFeeFilter((f) => (f === '50to100' ? 'all' : '50to100'))
              }
              label="0.50 – 1.00%"
              count={feeCounts.mid}
            />
            <FilterItem
              active={feeFilter === 'over100'}
              onClick={() =>
                setFeeFilter((f) => (f === 'over100' ? 'all' : 'over100'))
              }
              label="Over 1.00%"
              count={feeCounts.over}
            />
          </FilterGroup>

          <FilterGroup label="SIZE">
            <FilterItem
              active={sizeFilter === 'over1m'}
              onClick={() =>
                setSizeFilter((s) => (s === 'over1m' ? 'all' : 'over1m'))
              }
              label="Over $1M TVL"
            />
            <FilterItem
              active={sizeFilter === 'new'}
              onClick={() => setSizeFilter((s) => (s === 'new' ? 'all' : 'new'))}
              label="New this week"
            />
          </FilterGroup>
        </aside>

        {/* Main list */}
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-end justify-between gap-4 px-[22px] pb-5 pt-[26px]">
            <div>
              <h2 className="m-0 text-[32px] font-semibold tracking-[-0.03em]">
                All vaults
              </h2>
              <p className="mt-1.5 text-sm text-text-dim">
                Sorted by{' '}
                {sort === 'tvl' ? 'total value locked' : 'newest first'}
                {filtered.length > 0
                  ? ` · ${filtered.length} vault${filtered.length === 1 ? '' : 's'}`
                  : ''}
              </p>
            </div>
            <div className="flex gap-[7px] font-mono text-[10.5px] tracking-[0.08em]">
              <SortChip
                active={sort === 'tvl'}
                onClick={() => setSort('tvl')}
                label="TVL ↓"
              />
              <SortChip
                active={sort === 'new'}
                onClick={() => setSort('new')}
                label="NEW"
              />
            </div>
          </div>

          {/* Table header */}
          <div className="hidden grid-cols-[1.7fr_0.9fr_0.9fr_0.7fr] gap-3 border-y border-border bg-bg-elevated px-[22px] py-[11px] font-mono text-[9.5px] tracking-[0.13em] text-text-ghost sm:grid">
            <span>VAULT</span>
            <span className="text-right">TVL</span>
            <span className="text-right">ENTRY</span>
            <span className="text-right">ASSETS</span>
          </div>

          {loading && (
            <div className="px-[22px] py-4">
              <VaultListSkeleton rows={5} />
            </div>
          )}

          {!loading && error && (
            <p className="px-[22px] py-6 font-mono text-xs text-destructive">
              {error}
            </p>
          )}

          {!loading && !error && vaults.length === 0 && (
            <p className="px-[22px] py-6 text-sm text-text-dim">
              No vaults yet — open Create to mint one.
            </p>
          )}

          {!loading && !error && vaults.length > 0 && filtered.length === 0 && (
            <p className="px-[22px] py-6 text-sm text-text-dim">
              No vaults match these filters.
            </p>
          )}

          {!loading &&
            !error &&
            filtered.map((vault, idx) => (
              <VaultRow key={vault.vault_address} vault={vault} first={idx === 0} />
            ))}
        </div>
      </div>
    </div>
  );
}

function VaultRow({ vault, first }: { vault: VaultRecord; first: boolean }) {
  const colors = dotsForVault(vault.vault_id, vault.num_assets);
  const symbol = (vault.symbol || `V${vault.vault_id}`).toUpperCase();
  const name = displayName(vault.name);

  return (
    <Link
      href={vaultDetailPath(vault.vault_address)}
      className={`grid grid-cols-1 items-center gap-3 border-b border-white/[0.06] px-[22px] py-4 transition-colors hover:bg-accent/[0.04] sm:grid-cols-[1.7fr_0.9fr_0.9fr_0.7fr] ${
        first ? 'bg-accent/[0.03]' : ''
      }`}
    >
      <div className="flex min-w-0 items-center gap-[11px]">
        <span className="flex shrink-0">
          {colors.map((c, i) => (
            <span
              key={i}
              className="inline-block h-[22px] w-[22px] rounded-full"
              style={{
                background: c,
                marginLeft: i === 0 ? 0 : -8,
              }}
            />
          ))}
        </span>
        <span className="min-w-0">
          <span className="font-mono text-[13px]">{symbol}</span>
          <span className="ml-2 truncate text-[13.5px] text-text-dim">{name}</span>
        </span>
      </div>
      <span className="font-mono text-sm tabular-nums sm:text-right">
        <span className="mr-2 text-[10px] tracking-[0.1em] text-text-ghost sm:hidden">
          TVL
        </span>
        {formatTvl(vault.total_usdc_value)}
      </span>
      <span className="font-mono text-sm tabular-nums text-muted-foreground sm:text-right">
        <span className="mr-2 text-[10px] tracking-[0.1em] text-text-ghost sm:hidden">
          FEE
        </span>
        {formatFeeBps(vault.deposit_fee_bps)}
      </span>
      <span className="font-mono text-sm tabular-nums text-muted-foreground sm:text-right">
        <span className="mr-2 text-[10px] tracking-[0.1em] text-text-ghost sm:hidden">
          ASSETS
        </span>
        {vault.num_assets}
      </span>
    </Link>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] tracking-[0.14em] text-text-ghost">
        {label}
      </div>
      <div className="mt-3 flex flex-col gap-0.5 text-[13.5px]">{children}</div>
    </div>
  );
}

function FilterItem({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-[9px] py-[7px] text-left transition-colors ${
        active
          ? 'bg-accent/10 text-accent'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
      {count != null && (
        <span className={`ml-1.5 ${active ? 'text-text-dim' : 'text-text-ghost'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function SortChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border border-border-strong px-[11px] py-[7px] transition-colors ${
        active ? 'text-[#DADADE]' : 'text-text-faint hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}
